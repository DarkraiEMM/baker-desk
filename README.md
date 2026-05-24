# Baker Desk Prototype

本目录是 Baker Desk 的本地桌面版项目。

当前交接文档见：

```text
docs/project-brief-2026-05-23.md
```

当前状态：

- React + TypeScript + Vite
- 本地配方数据从 `public/data` 加载
- 支持配方录入：表单录入、Markdown 粘贴导入、浏览器本地保存
- 支持录入整理助手：粘贴手写转文字或网页片段，可整理成 Baker Desk Markdown 草稿；桌面版会优先尝试内置 Qwen，失败时回退本地规则
- 支持本地数据迁移：导出/导入用户数据包，带走本地配方、星标/标签和固定项
- 桌面版已内置本地 AI：`llama.cpp` CPU 运行器 + Qwen GGUF 模型
- 内置 42 份可计算配方：原仓库示例、Baker Desk 种子基础配方、本地示例、公开授权配方、手写导入配方
- 已迁移核心配方解析、Baker's %、缩放计算逻辑
- 已有 ChatGPT 风格入口；本地规则负责烘焙判断，桌面版用内置 Qwen 辅助意图解析和基于候选配方的自然回答
- 技法知识库可本地预览，已补充替代、模具换算、温度和失败排查卡片

## 运行

```powershell
cd F:\BakerDesk\app
npm.cmd install
npm.cmd run dev -- --port 5173
```

浏览器打开：

```text
http://127.0.0.1:5173
```

## 桌面版

项目已经接入 Tauri 桌面壳，配置在 `src-tauri/`。

当前机器已安装 Rust/Cargo 和 Windows C++ Build Tools，可以运行：

```powershell
cd F:\BakerDesk\app
npm.cmd run tauri:dev
```

打包安装器：

```powershell
npm.cmd run build
npm.cmd run test:chat
npm.cmd run tauri:build
```

当前已生成桌面版成品：

```text
F:\BakerDesk\dist\BakerDesk-Setup-0.1.7-x64.exe
```

更多说明见 `DESKTOP.md`。

## 内置 AI

桌面版会随包携带本地模型资源：

```text
src-tauri/resources/ai/bin/llama-server.exe
src-tauri/resources/ai/models/qwen2.5-3b-instruct-q3_k_m.gguf
```

运行逻辑：

- 首次对话时启动本地 `llama-server`，低线程加载 Qwen2.5 1.5B Instruct 的 Q4_K_M 量化模型
- 后端使用 `/completion` + ChatML 提示格式，避开部分 llama-server chat 模板导致的中文跑偏
- Qwen 负责两件事：把自然语言解析成意图 JSON；在本地规则选出候选后，把建议改写成自然中文回答
- 配方查找、缩放、Baker's % 计算仍由本地配方库执行
- 浏览器开发预览不会启动模型，只显示规则/预览状态

当前默认参数偏保守：CPU 2 线程、2048 context、低优先级。第一次加载模型会有短暂 CPU 占用，后续会复用本地服务。

### 意图训练样本

Baker Desk 目前不做昂贵的模型微调，而是使用轻量训练样本增强意图解析。样本位置：

```text
src/trainingSet.ts
```

这些样本会随每次 Qwen 意图解析一起发送，帮助模型理解“需要不油腻的配方”“适合夏天的清爽夹心”“哪些配方用到了 beurre”这类自然表达。

## 构建

```powershell
npm.cmd run build
npm.cmd run test:chat
```

构建产物会输出到：

```text
F:\BakerDesk\app\dist
```

## 问答回归测试

常见烘焙问法的本地规则测试在：

```text
tests/chatEngine.test.ts
```

运行：

```powershell
npm.cmd run test:chat
```

覆盖配方查找、缩放、原料检索、技法查询、早餐/低升糖推荐、坚果搭配、替代、模具换算、失败排查和烤箱温度等问题，避免后续继续靠手动一条条试。

## 已支持的本地命令

```text
查一下 brioche
帮我把 brioche 缩放到 500g 面粉
哪些配方用到了 beurre
甘那许比例是多少
查一下卡仕达配方
帮我把泡芙面糊缩放到 300g 面粉
```

## 数据来源标注

所有配方和技法都会在卡片和详情里显示来源：

- `lcb-baker-agent 示例配方`：原仓库自带的示例 Markdown
- `Baker Desk 种子配方`：依据原仓库知识卡里的比例转写为可计算配方
- `Baker Desk 本地示例配方`：当前原型补充的测试样例
- `Baker Desk 手写配方`：用户提供的手写照片，已转写为可计算结构化配方
- `Wikibooks / Wikilivres`：公开授权资料，按 CC BY-SA 标注来源
- `Baker Desk 公开资料整理`：基于公开烘焙指南和问答归纳的中文技法卡
- `public domain historical recipe`：公版历史资料，已转为 Baker Desk 结构化格式
- `本地录入`：用户在 `录入` 页面新增或导入的配方
- `技法笔记引用`：知识卡里提到但当前包内没有完整原料表的库内实例
- `技法卡片`：有明确抽取来源的知识卡
- `资料归档`：暂时缺明确来源或质量不如主卡的整理材料，仍可搜索和引用

配方和技法还支持常用/优势标注：

- `featured: true`：显示星标“常用”，并在列表中优先显示
- `badges: stable, scalable, filling`：显示图形优势标签，用于标注稳定、易缩放、内馅、结构、酥脆、巧克力等特点
- 在详情页可直接切换“常用”、点选优势标签，或输入自定义标签；当前会保存到浏览器/桌面 WebView 的本地设置

## 配方录入

进入左侧 `录入` 页面，可以：

- 用表单录入配方名、组成、原料重量和步骤
- 粘贴 Markdown 配方并导入
- 粘贴普通文本后点 `整理草稿`，自动抽取标题、原料克重和步骤，再人工复核导入
- 导入后自动进入配方库，并可参与搜索、Baker's % 和缩放

当前原型会保存到浏览器 `localStorage`。后续 Tauri 桌面版会改为写入本地配方文件夹。

## 数据迁移

`录入` 页面提供 `导出数据包` 和 `导入数据包`：

- 导出内容：本地录入配方、常用星标、优势标签、自定义标签、图钉固定项
- 导入方式：在新电脑安装 Baker Desk 后，进入 `录入` 页面选择导出的 `.json` 数据包
- 合并规则：同 ID 的本地配方会被数据包里的版本覆盖；内置配方库不会被修改
- 隔离规则：Baker Desk 自带 `public/data` 库保持只读，用户导入内容只进入本机用户数据

建议换电脑前导出一份 `baker-desk-backup-日期.json`，和安装包放在一起备份。

### 录入规则

为了让配方能稳定搜索、计算和缩放，录入时遵循这些规则：

- 标题：优先使用“法文/英文 + 中文”，例如 `BRIOCHE CLASSIQUE 经典布里欧修`
- 组成：用 `##` 表示组件，例如 `## Pâte à Brioche 面团`
- 原料：使用 Markdown 表格，每一行必须有数字重量
- 单位：优先用 `g`；可用 `kg`、`mg`、`ml`、`cl`、`dl`、`l`
- 基准：面团默认识别 `farine`；甘那许建议使用 `chocolat`；奶油馅按主原料手动指定
- 步骤：写清温度、时间、发酵、冷藏、凝固等关键信息
- 版权：只录入自己有权使用的配方；课程/书籍配方建议仅用于个人本地学习

推荐 Markdown 格式：

```markdown
---
titre: BRIOCHE CLASSIQUE
niveau: basique
source: local
source_file: local-entry
base_hint: farine
featured: true
badges: classic, stable, scalable
---

# BRIOCHE CLASSIQUE 经典布里欧修

## Pâte à Brioche 面团

| Ingrédients | 食材 |
|-------------|------|
| 250 g de farine T45 | 250 克 T45 面粉 |
| 150 g de beurre | 150 克黄油 |

Pétrir puis cuire à 180°C / 20min.
```

## 下一步

1. 把录入保存从 localStorage 改成本地 Markdown 文件夹
2. 增加批量导入和 manifest 生成
3. 给 Qwen 服务增加手动启动/停止和资源占用提示
4. 增加 GPU/Vulkan 运行器可选包
5. 做完整离线安装包校验清单
