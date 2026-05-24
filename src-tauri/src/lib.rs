use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri::RunEvent;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const AI_HOST: &str = "127.0.0.1";
const AI_PORT: u16 = 18089;
const AI_ENDPOINT: &str = "/completion";
const OLLAMA_HOST: &str = "127.0.0.1";
const OLLAMA_PORT: u16 = 11434;
const OLLAMA_TAGS_ENDPOINT: &str = "/api/tags";
const OLLAMA_GENERATE_ENDPOINT: &str = "/api/generate";

struct AiServerState {
    child: Mutex<Option<Child>>,
}

#[derive(Debug)]
struct AiAssets {
    engine_path: Option<PathBuf>,
    model_path: Option<PathBuf>,
    data_dir: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStatus {
    available: bool,
    ready: bool,
    mode: String,
    engine: String,
    model: String,
    engine_path: Option<String>,
    model_path: Option<String>,
    data_dir: String,
    detail: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiIntentRequest {
    prompt: String,
    recipe_index: String,
    knowledge_index: String,
    training_examples: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiRecipeDraftRequest {
    raw: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiGroundedReplyRequest {
    prompt: String,
    local_reply: String,
    recipe_index: String,
    knowledge_index: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiIntentResponse {
    text: String,
    json: Option<String>,
    markdown: Option<String>,
    engine: String,
    model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecipePackFile {
    path: String,
    raw: String,
}

#[tauri::command]
fn baker_ai_status(app: AppHandle) -> AiStatus {
    if let Some(model) = detect_ollama_model(Duration::from_millis(700)) {
        return AiStatus {
            available: true,
            ready: true,
            mode: "ollama-local".into(),
            engine: "Ollama".into(),
            model,
            engine_path: None,
            model_path: None,
            data_dir: path_to_string(
                &app.path()
                    .app_data_dir()
                    .unwrap_or_else(|_| fallback_data_dir())
                    .join("ai"),
            ),
            detail: "外置 Ollama 可用：主对话会把本地配方/技法候选交给 Ollama 组织回答；没有命中时仍会回退内置 Qwen 或本地规则。".into(),
        };
    }
    resolve_ai_assets(&app).to_status()
}

#[tauri::command]
fn baker_ai_stop(state: tauri::State<AiServerState>) -> Result<(), String> {
    stop_ai_server(&state)
}

#[tauri::command]
fn baker_ai_intent(app: AppHandle, state: tauri::State<AiServerState>, request: AiIntentRequest) -> Result<AiIntentResponse, String> {
    if request.prompt.trim().is_empty() {
        return Err("请输入要解析的内容。".into());
    }

    let prompt = build_intent_prompt(&request);
    let system = "你是烘焙软件 Baker Desk 的本地意图分类器，不是家具助手。只按最后的用户输入输出一个 JSON 对象，不要解释，不要 Markdown，不要复读示例，不要编配方。";
    if let Some(model) = detect_ollama_model(Duration::from_millis(500)) {
        if let Ok(text) = post_ollama_generate(&prompt, system, 160, 0.1, &model) {
            return Ok(AiIntentResponse {
                json: extract_json_object(&text),
                markdown: None,
                text,
                engine: "Ollama".into(),
                model,
            });
        }
    }

    let assets = resolve_ai_assets(&app);
    let engine_path = assets
        .engine_path
        .clone()
        .ok_or_else(|| "没有找到内置 llama.cpp server。".to_string())?;
    let model_path = assets
        .model_path
        .clone()
        .ok_or_else(|| "没有找到内置 Qwen GGUF 模型。".to_string())?;

    ensure_ai_server(&state, &engine_path, &model_path)?;
    let text = post_completion(&prompt)?;

    Ok(AiIntentResponse {
        json: extract_json_object(&text),
        markdown: None,
        text,
        engine: file_label(&engine_path),
        model: file_label(&model_path),
    })
}

#[tauri::command]
fn baker_ai_recipe_draft(app: AppHandle, state: tauri::State<AiServerState>, request: AiRecipeDraftRequest) -> Result<AiIntentResponse, String> {
    if request.raw.trim().is_empty() {
        return Err("请先粘贴要整理的配方文本。".into());
    }

    let prompt = build_recipe_draft_prompt(&request);
    let system = "你是 Baker Desk 的配方录入整理器。只把用户给出的原文整理成 Markdown，不要编造缺失重量，不要输出解释。";
    if let Some(model) = detect_ollama_model(Duration::from_millis(500)) {
        if let Ok(text) = post_ollama_generate(&prompt, system, 620, 0.1, &model) {
            let markdown = extract_markdown_block(&text).unwrap_or_else(|| text.trim().to_string());
            return Ok(AiIntentResponse {
                json: None,
                markdown: Some(markdown),
                text,
                engine: "Ollama".into(),
                model,
            });
        }
    }

    let assets = resolve_ai_assets(&app);
    let engine_path = assets
        .engine_path
        .clone()
        .ok_or_else(|| "没有找到内置 llama.cpp server。".to_string())?;
    let model_path = assets
        .model_path
        .clone()
        .ok_or_else(|| "没有找到内置 Qwen GGUF 模型。".to_string())?;

    ensure_ai_server(&state, &engine_path, &model_path)?;
    let text = post_completion_with_options(&prompt, system, 520, 0.1)?;
    let markdown = extract_markdown_block(&text).unwrap_or_else(|| text.trim().to_string());

    Ok(AiIntentResponse {
        json: None,
        markdown: Some(markdown),
        text,
        engine: file_label(&engine_path),
        model: file_label(&model_path),
    })
}

#[tauri::command]
fn baker_ai_grounded_reply(app: AppHandle, state: tauri::State<AiServerState>, request: AiGroundedReplyRequest) -> Result<AiIntentResponse, String> {
    if request.prompt.trim().is_empty() {
        return Err("请输入要回答的内容。".into());
    }

    let prompt = build_grounded_reply_prompt(&request);
    let system = "你是 Baker Desk 的中文烘焙助手。必须基于给定的本地候选配方和规则结论回答。不要编造库外配方，不要说自己是 AI。语气自然、简洁、像在给伴侣做烘焙建议。";
    if let Some(model) = detect_ollama_model(Duration::from_millis(500)) {
        if let Ok(text) = post_ollama_generate(&prompt, system, 760, 0.35, &model) {
            return Ok(AiIntentResponse {
                json: None,
                markdown: None,
                text,
                engine: "Ollama".into(),
                model,
            });
        }
    }

    let assets = resolve_ai_assets(&app);
    let engine_path = assets
        .engine_path
        .clone()
        .ok_or_else(|| "没有找到内置 llama.cpp server。".to_string())?;
    let model_path = assets
        .model_path
        .clone()
        .ok_or_else(|| "没有找到内置 Qwen GGUF 模型。".to_string())?;

    ensure_ai_server(&state, &engine_path, &model_path)?;
    let text = post_completion_with_options(&prompt, system, 620, 0.35)?;

    Ok(AiIntentResponse {
        json: None,
        markdown: None,
        text,
        engine: file_label(&engine_path),
        model: file_label(&model_path),
    })
}

#[tauri::command]
fn baker_read_recipe_packs(app: AppHandle) -> Result<Vec<RecipePackFile>, String> {
    let mut files = Vec::new();
    let mut seen_dirs = HashSet::new();

    for dir in recipe_pack_dirs(&app) {
        let key = path_to_string(&dir);
        if !seen_dirs.insert(key) || !dir.is_dir() {
            continue;
        }

        let entries = fs::read_dir(&dir).map_err(|error| format!("读取配方包目录失败：{error}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !is_json_file(&path) {
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.len() > 2 * 1024 * 1024 {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(&path) {
                files.push(RecipePackFile {
                    path: path_to_string(&path),
                    raw,
                });
            }
        }
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

impl AiAssets {
    fn to_status(&self) -> AiStatus {
        let engine = self
            .engine_path
            .as_ref()
            .map(|path| file_label(path))
            .unwrap_or_else(|| "未找到运行器".into());
        let model = self
            .model_path
            .as_ref()
            .map(|path| file_label(path))
            .unwrap_or_else(|| "未找到模型".into());
        let ready = self.engine_path.is_some() && self.model_path.is_some();

        AiStatus {
            available: self.engine_path.is_some() || self.model_path.is_some(),
            ready,
            mode: if ready { "qwen-local".into() } else { "rules".into() },
            engine,
            model,
            engine_path: self.engine_path.as_ref().map(|path| path_to_string(path)),
            model_path: self.model_path.as_ref().map(|path| path_to_string(path)),
            data_dir: path_to_string(&self.data_dir),
            detail: if ready {
                "内置 Qwen 可用：主对话会先用本地规则选候选，再把候选交给 Qwen 组织成自然回答。".into()
            } else {
                "仍在本地规则模式：请确认 ai/bin/llama-server.exe 和 ai/models/*.gguf 已随程序打包或放入用户数据目录。".into()
            },
        }
    }
}

fn resolve_ai_assets(app: &AppHandle) -> AiAssets {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| fallback_data_dir())
        .join("ai");
    let _ = fs::create_dir_all(data_dir.join("bin"));
    let _ = fs::create_dir_all(data_dir.join("models"));

    let mut roots = vec![data_dir.clone()];
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir.join("resources").join("ai"));
        roots.push(resource_dir.join("ai"));
        roots.push(resource_dir);
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("ai"));

    AiAssets {
        engine_path: roots.iter().find_map(|root| find_engine(root)),
        model_path: roots.iter().find_map(|root| find_model(root)),
        data_dir,
    }
}

fn fallback_data_dir() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("baker-desk-user-data")
}

fn find_engine(root: &Path) -> Option<PathBuf> {
    let names = if cfg!(windows) {
        ["llama-server.exe", "llama-cli.exe", "llama.exe"]
    } else {
        ["llama-server", "llama-cli", "llama"]
    };
    for name in names {
        let direct = root.join(name);
        if direct.exists() {
            return Some(direct);
        }
        let nested = root.join("bin").join(name);
        if nested.exists() {
            return Some(nested);
        }
    }
    None
}

fn find_model(root: &Path) -> Option<PathBuf> {
    let mut models = Vec::new();
    collect_gguf(&root.join("models"), &mut models);
    collect_gguf(root, &mut models);
    models.sort_by_key(|path| {
        let name = file_label(path).to_lowercase();
        if name.contains("qwen2.5") && name.contains("3b") {
            0
        } else if name.contains("qwen2.5") && name.contains("1.5b") {
            1
        } else if name.contains("qwen3") {
            2
        } else if name.contains("qwen") {
            3
        } else {
            4
        }
    });
    models.into_iter().next()
}

fn collect_gguf(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("gguf")) {
            out.push(path);
        }
    }
}

fn ensure_ai_server(state: &AiServerState, engine_path: &Path, model_path: &Path) -> Result<(), String> {
    if is_server_ready() {
        return Ok(());
    }

    {
        let mut guard = state.child.lock().map_err(|_| "AI 服务状态锁定失败。".to_string())?;
        if let Some(child) = guard.as_mut() {
            if child.try_wait().map_err(|error| format!("检查 AI 服务失败：{error}"))?.is_none() {
                drop(guard);
                return wait_for_server(Duration::from_secs(45));
            }
        }

        let mut command = Command::new(engine_path);
        command
            .current_dir(engine_path.parent().unwrap_or_else(|| Path::new(".")))
            .arg("-m")
            .arg(model_path)
            .arg("--host")
            .arg(AI_HOST)
            .arg("--port")
            .arg(AI_PORT.to_string())
            .arg("--threads")
            .arg("2")
            .arg("--threads-batch")
            .arg("2")
            .arg("--ctx-size")
            .arg("4096")
            .arg("--batch-size")
            .arg("256")
            .arg("--ubatch-size")
            .arg("128")
            .arg("--jinja")
            .arg("--reasoning")
            .arg("off")
            .arg("--prio")
            .arg("-1")
            .arg("--timeout")
            .arg("120")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let child = command
            .spawn()
            .map_err(|error| format!("启动内置 Qwen 服务失败：{error}"))?;
        *guard = Some(child);
    }

    wait_for_server(Duration::from_secs(60))
}

fn stop_ai_server(state: &AiServerState) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|_| "AI 服务状态锁定失败。".to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

fn wait_for_server(timeout: Duration) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if is_server_ready() && server_health_status().is_some_and(|status| status == 200) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(300));
    }
    Err("内置 Qwen 服务启动超时。首次加载模型可能较慢，请稍后再试。".into())
}

fn is_server_ready() -> bool {
    TcpStream::connect((AI_HOST, AI_PORT)).is_ok()
}

fn server_health_status() -> Option<u16> {
    let request = format!("GET /health HTTP/1.1\r\nHost: {AI_HOST}:{AI_PORT}\r\nConnection: close\r\n\r\n");
    read_http_status(&request, Duration::from_secs(2)).ok()
}

fn post_completion(prompt: &str) -> Result<String, String> {
    post_completion_with_options(
        prompt,
        "你是烘焙软件 Baker Desk 的本地意图分类器，不是家具助手。只按最后的用户输入输出一个 JSON 对象，不要解释，不要 Markdown，不要复读示例，不要编配方。",
        120,
        0.1,
    )
}

fn post_completion_with_options(prompt: &str, system: &str, max_tokens: u16, temperature: f32) -> Result<String, String> {
    let chat_prompt = build_completion_prompt(system, prompt);
    let payload = serde_json::json!({
        "prompt": chat_prompt,
        "n_predict": max_tokens,
        "temperature": temperature,
        "top_p": if temperature > 0.2 { 0.9 } else { 0.8 },
        "stream": false,
        "stop": ["<|im_end|>", "</s>"]
    });
    let body = payload.to_string();
    let request = format!(
        "POST {AI_ENDPOINT} HTTP/1.1\r\nHost: {AI_HOST}:{AI_PORT}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );

    let mut last_error = String::new();
    for _ in 0..8 {
        match read_http_body(&request, Duration::from_secs(120)).and_then(|response| parse_completion_response(&response)) {
            Ok(text) => return Ok(text),
            Err(error) if error.contains("503") || error.contains("Service Unavailable") => {
                last_error = error;
                thread::sleep(Duration::from_secs(2));
            }
            Err(error) => return Err(error),
        }
    }
    Err(format!("AI 服务仍未就绪：{last_error}"))
}

fn post_ollama_generate(prompt: &str, system: &str, max_tokens: u16, temperature: f32, model: &str) -> Result<String, String> {
    let payload = serde_json::json!({
        "model": model,
        "system": system,
        "prompt": prompt,
        "stream": false,
        "options": {
            "num_predict": max_tokens,
            "num_ctx": 4096,
            "temperature": temperature,
            "top_p": if temperature > 0.2 { 0.9 } else { 0.8 }
        }
    });
    let body = payload.to_string();
    let request = format!(
        "POST {OLLAMA_GENERATE_ENDPOINT} HTTP/1.1\r\nHost: {OLLAMA_HOST}:{OLLAMA_PORT}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let response = read_http_body_at(OLLAMA_HOST, OLLAMA_PORT, &request, Duration::from_secs(150), "Ollama")?;
    parse_ollama_generate_response(&response)
}

fn detect_ollama_model(timeout: Duration) -> Option<String> {
    let request = format!("GET {OLLAMA_TAGS_ENDPOINT} HTTP/1.1\r\nHost: {OLLAMA_HOST}:{OLLAMA_PORT}\r\nConnection: close\r\n\r\n");
    let response = read_http_body_at(OLLAMA_HOST, OLLAMA_PORT, &request, timeout, "Ollama").ok()?;
    let body = decoded_success_body(&response, "Ollama").ok()?;
    let value: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
    let mut models = value
        .get("models")?
        .as_array()?
        .iter()
        .filter_map(|item| item.get("name").and_then(|name| name.as_str()).map(|name| name.to_string()))
        .collect::<Vec<_>>();
    models.sort_by_key(|name| ollama_model_rank(name));
    models.into_iter().next()
}

fn ollama_model_rank(name: &str) -> u8 {
    let lower = name.to_lowercase();
    if lower.contains("qwen") && (lower.contains("14b") || lower.contains("32b") || lower.contains("7b") || lower.contains("8b")) {
        0
    } else if lower.contains("qwen2.5") && lower.contains("3b") {
        1
    } else if lower.contains("qwen") {
        2
    } else if lower.contains("deepseek") && !lower.contains("coder") {
        3
    } else if lower.contains("llama") || lower.contains("mistral") || lower.contains("gemma") {
        4
    } else {
        5
    }
}

fn parse_ollama_generate_response(response: &str) -> Result<String, String> {
    let body = decoded_success_body(response, "Ollama")?;
    let value: serde_json::Value = serde_json::from_str(body.trim()).map_err(|error| format!("Ollama JSON 解析失败：{error}"))?;
    value
        .get("response")
        .and_then(|content| content.as_str())
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "Ollama 响应里没有 response。".into())
}

fn build_completion_prompt(system: &str, prompt: &str) -> String {
    let clean_system = system.replace("/no_think", "").trim().to_string();
    let clean_prompt = prompt.replace("/no_think", "").trim().to_string();
    format!(
        "<|im_start|>system\n{}<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n",
        clean_system, clean_prompt
    )
}

fn read_http_status(request: &str, timeout: Duration) -> Result<u16, String> {
    let response = read_http_body(request, timeout)?;
    let status_line = response.lines().next().ok_or_else(|| "AI 响应缺少状态行。".to_string())?;
    status_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "AI 响应状态行异常。".to_string())?
        .parse::<u16>()
        .map_err(|error| format!("AI 响应状态码解析失败：{error}"))
}

fn read_http_body(request: &str, timeout: Duration) -> Result<String, String> {
    read_http_body_at(AI_HOST, AI_PORT, request, timeout, "内置 Qwen")
}

fn read_http_body_at(host: &str, port: u16, request: &str, timeout: Duration, label: &str) -> Result<String, String> {
    let mut stream = TcpStream::connect((host, port)).map_err(|error| format!("连接 {label} 服务失败：{error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("设置 {label} 读取超时失败：{error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| format!("设置 {label} 写入超时失败：{error}"))?;
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("发送 {label} 请求失败：{error}"))?;
    stream.flush().map_err(|error| format!("刷新 {label} 请求失败：{error}"))?;

    let mut buffer = Vec::new();
    let mut scratch = [0_u8; 8192];
    let mut header_end = None;

    while header_end.is_none() {
        let count = stream
            .read(&mut scratch)
            .map_err(|error| format!("读取 {label} 响应头失败：{error}"))?;
        if count == 0 {
            break;
        }
        buffer.extend_from_slice(&scratch[..count]);
        header_end = find_header_end(&buffer);
    }

    let header_end = header_end.ok_or_else(|| format!("{label} 响应缺少 HTTP 头。"))?;
    let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let body_start = header_end + 4;

    if let Some(content_length) = parse_content_length(&head) {
        let target_len = body_start + content_length;
        while buffer.len() < target_len {
            let count = stream
                .read(&mut scratch)
                .map_err(|error| format!("读取 {label} 响应体失败：{error}"))?;
            if count == 0 {
                break;
            }
            buffer.extend_from_slice(&scratch[..count]);
        }
        if buffer.len() < target_len {
            return Err(format!(
                "{label} 响应体不完整：需要 {content_length} 字节，实际收到 {} 字节。",
                buffer.len().saturating_sub(body_start)
            ));
        }
        buffer.truncate(target_len);
        return String::from_utf8(buffer).map_err(|error| format!("{label} 响应 UTF-8 解析失败：{error}"));
    }

    if head.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        while !chunked_body_complete(&buffer[body_start..]) {
            let count = stream
                .read(&mut scratch)
                .map_err(|error| format!("读取 {label} chunked 响应失败：{error}"))?;
            if count == 0 {
                break;
            }
            buffer.extend_from_slice(&scratch[..count]);
        }
        return String::from_utf8(buffer).map_err(|error| format!("{label} 响应 UTF-8 解析失败：{error}"));
    }

    loop {
        match stream.read(&mut scratch) {
            Ok(0) => break,
            Ok(count) => buffer.extend_from_slice(&scratch[..count]),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                ) =>
            {
                if buffer.len() > body_start {
                    break;
                }
                return Err(format!("读取 {label} 响应超时：{error}"));
            }
            Err(error) => return Err(format!("读取 {label} 响应失败：{error}")),
        }
    }

    String::from_utf8(buffer).map_err(|error| format!("{label} 响应 UTF-8 解析失败：{error}"))
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_content_length(head: &str) -> Option<usize> {
    head.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim().eq_ignore_ascii_case("content-length") {
            value.trim().parse::<usize>().ok()
        } else {
            None
        }
    })
}

fn chunked_body_complete(body: &[u8]) -> bool {
    body.windows(5).any(|window| window == b"\r\n0\r\n") || body.ends_with(b"0\r\n\r\n")
}

fn decoded_success_body(response: &str, label: &str) -> Result<String, String> {
    let Some((head, body)) = response.split_once("\r\n\r\n") else {
        return Err(format!("{label} 响应格式异常。"));
    };
    if !head.contains(" 200 ") {
        let detail = if body.trim().is_empty() {
            String::new()
        } else {
            format!("；{}", body.trim().chars().take(500).collect::<String>())
        };
        return Err(format!(
            "{label} 返回异常：{}{}",
            head.lines().next().unwrap_or(head),
            detail
        ));
    }
    if head.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        decode_chunked_body(body)
    } else {
        Ok(body.trim().to_string())
    }
}

fn parse_completion_response(response: &str) -> Result<String, String> {
    let Some((head, body)) = response.split_once("\r\n\r\n") else {
        return Err("AI 响应格式异常。".into());
    };
    if !head.contains(" 200 ") {
        let detail = if body.trim().is_empty() {
            String::new()
        } else {
            format!("；{}", body.trim().chars().take(500).collect::<String>())
        };
        return Err(format!(
            "AI 服务返回异常：{}{}",
            head.lines().next().unwrap_or(head),
            detail
        ));
    }

    let decoded = if head.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        decode_chunked_body(body)?
    } else {
        body.trim().to_string()
    };
    let value: serde_json::Value = serde_json::from_str(decoded.trim()).map_err(|error| format!("AI JSON 解析失败：{error}"))?;
    value
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .or_else(|| value.get("content").and_then(|content| content.as_str()))
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "AI 响应里没有 content。".into())
}

fn decode_chunked_body(body: &str) -> Result<String, String> {
    let mut remaining = body;
    let mut decoded = String::new();

    loop {
        let Some((size_line, rest)) = remaining.split_once("\r\n") else {
            return Err("AI chunked 响应格式异常。".into());
        };
        let size = usize::from_str_radix(size_line.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|error| format!("AI chunk 大小解析失败：{error}"))?;
        if size == 0 {
            return Ok(decoded);
        }
        if rest.len() < size + 2 {
            return Err("AI chunked 响应不完整。".into());
        }
        decoded.push_str(&rest[..size]);
        remaining = &rest[size + 2..];
    }
}

fn build_intent_prompt(request: &AiIntentRequest) -> String {
    format!(
        r#"Baker Desk 是烘焙配方软件，不是桌子或家具。
你的任务只是在用户输入和本地配方库之间做意图分类。
只输出一个 JSON 对象，不要解释，不要 Markdown，不要编造新配方。

允许的 intent：
- find_recipe：用户想查某个配方
- scale_recipe：用户想把配方按某个基准重量缩放
- ingredient_search：用户想找用到某个原料的配方
- recommend_recipe：用户描述口感、油腻程度、用途或偏好，想要推荐配方
- show_knowledge：用户想看技法/知识卡
- answer：其他普通问题

JSON 字段：
- intent：必须是允许的 intent 之一
- recipe_query：配方 id/标题；没有就写空字符串
- target_grams：数字；没有就写 null
- base_hint：farine/chocolat/lait/oeuf/cream/beurre 等；不确定写空字符串
- ingredient_query：原料检索词；没有写空字符串
- doc_query：技法检索词；没有写空字符串
- reply：偏好关键词或简短说明；不要写做法

规则：
- recipe_query 必须尽量匹配下面的配方 id 或标题。
- target_grams 只写数字，没有目标重量就写 null。
- base_hint 可用 farine/chocolat/lait/oeuf/cream/beurre 等；不确定就写空字符串。
- “不油腻、清爽、轻盈、少油、适合夏天”这类需求用 recommend_recipe。
- “不要奶油、不需要奶油、黄油为主、主要材料是黄油”这类偏好也用 recommend_recipe。
- 不要复制训练样本里的 JSON；必须根据最后的用户输入重新判断。
- 不要编造库里没有的配方。

训练样本：
{}

可用配方：
{}

可用技法：
{}

用户输入：
{}"#,
        request.training_examples, request.recipe_index, request.knowledge_index, request.prompt
    )
}

fn build_recipe_draft_prompt(request: &AiRecipeDraftRequest) -> String {
    format!(
        r#"Baker Desk 是烘焙配方软件。请把用户粘贴的配方原文整理成 Baker Desk Markdown。

硬规则：
- 只使用原文里出现的信息，不要补配方、不要补克重、不要改比例。
- 如果原文没有重量，保留原料名并在步骤里提示“缺重量，需人工补齐”；不要猜。
- 标题优先中文；可保留英文/法文作为第二显示名。
- 每个原料表必须使用两列：| Ingrédients | 食材 |
- 原料行写成：| 100 g de butter | 100 克黄油 |
- 如果有多个组成，用多个 `##` 分段；不确定就用 `## Appareil principal 主体`。
- 输出完整 Markdown，不要解释，不要 Markdown 代码围栏。

推荐格式：
---
titre: 配方名
niveau: local
source: 本地录入草稿
source_file: ai-assisted-local
base_hint: farine
featured: false
badges: draft, local
---

# 配方名

## Appareil principal 主体

| Ingrédients | 食材 |
|-------------|------|
| 100 g de ingredient | 100 克原料 |

步骤写在表格后。

用户原文：
{}"#,
        request.raw.trim()
    )
}

fn build_grounded_reply_prompt(request: &AiGroundedReplyRequest) -> String {
    format!(
        r#"用户问题：
{}

Baker Desk 本地规则已经给出的结论：
{}

可用本地配方索引：
{}

可用技法卡片：
{}

请基于用户问题、对话上下文、本地结论和本地索引，组织成自然中文回答。
要求：
- 只推荐本地索引里出现的配方或技法。
- 优先尊重“本地规则已经给出的结论”；如果本地结论只是能力说明、没有覆盖当前追问，可以结合对话上下文和本地索引直接回答。
- 如果本地结论里包含“规则评分材料”，必须按候选评分、糖/油/黄油/奶油/酸度等指标做取舍；高风险或被避开的候选不能反向推荐。
- 如果结论说某配方要避开、放后面或不符合目标，不要把它列为推荐。
- 如果有取舍，说明为什么推荐、为什么避开。
- 禁止新增材料、重量、步骤或库里没有的配方。
- 不要输出 JSON，不要 Markdown 表格，不要长篇解释。
- 3 到 7 句话即可，适合直接显示在聊天气泡里。
- 不要说“根据本地规则”或“预设”；要像一个懂烘焙的人在回答。"#,
        request.prompt.trim(),
        request.local_reply.trim(),
        request.recipe_index,
        request.knowledge_index
    )
}

fn extract_json_object(text: &str) -> Option<String> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(text[start..=end].to_string())
}

fn extract_markdown_block(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if let Some(after_open) = trimmed.split_once("```") {
        let content = after_open.1;
        let content = content
            .strip_prefix("markdown")
            .or_else(|| content.strip_prefix("md"))
            .unwrap_or(content)
            .trim_start();
        if let Some((block, _)) = content.split_once("```") {
            return Some(block.trim().to_string());
        }
    }
    if trimmed.contains("| Ingrédients |") || trimmed.contains("titre:") {
        return Some(trimmed.to_string());
    }
    None
}

fn recipe_pack_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Some(root) = resource_dir.parent() {
            dirs.push(root.join("recipe-packs"));
        }
        dirs.push(resource_dir.join("recipe-packs"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe.parent() {
            dirs.push(root.join("recipe-packs"));
        }
    }
    if let Ok(app_data) = app.path().app_data_dir() {
        dirs.push(app_data.join("recipe-packs"));
    }
    dirs
}

fn is_json_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("json"))
        .unwrap_or(false)
}

fn file_label(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path_to_string(path))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ai_state = AiServerState {
        child: Mutex::new(None),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ai_state)
        .invoke_handler(tauri::generate_handler![
            baker_ai_status,
            baker_ai_stop,
            baker_ai_intent,
            baker_ai_recipe_draft,
            baker_ai_grounded_reply,
            baker_read_recipe_packs
        ])
        .build(tauri::generate_context!())
        .expect("error while building Baker Desk")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(state) = app.try_state::<AiServerState>() {
                    let _ = stop_ai_server(&state);
                }
            }
        });
}
