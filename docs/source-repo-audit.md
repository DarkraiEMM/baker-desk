# Baker Desk 源仓库资产盘点

盘点对象：`chefkannofriend-source/lcb-baker-agent`

本地路径：`C:\Users\76389\Documents\Codex\2026-05-22\chefkannofriend-source-lcb-baker-agent-https`

远端状态：`origin/main` 指向 `2442db9 Initial release: LCB Baker Agent for Claude Code`，没有发现其它分支或 tag。

补充核对：小红书帖子 `https://www.xiaohongshu.com/explore/6a1006490000000007020682` 标题为“16万的蓝带甜品课程,现在免费送给所有人”，公开正文写“我把整个蓝带甜点塞进了一个文件夹”。视频截图和评论区指向同一个 GitHub 仓库 `chefkannofriend-source/lcb-baker-agent`，没有看到额外下载链接或隐藏配方库证据。

热度风险：GitHub issue `#1` 由 `phantomstars` 报告该仓库存在疑似 fake star/fork campaign。报告称 2026-05-23 扫描 24 小时窗口内 80 个互动账号，其中 46 个被判为 likely fake、12 个 suspicious，仓库分类为 `likely_fake`。这不是 GitHub 官方处罚，也不是代码恶意证明，但说明 star/fork 热度不应作为可信度依据。

## 源仓库实际包含内容

| 类型 | 文件/目录 | 数量 | 价值判断 |
| --- | --- | ---: | --- |
| Agent 说明 | `agents/baker.md` | 1 | 高。包含问题路由、知识文件映射、搜索顺序、质量判断流程。 |
| 测试题库 | `BAKER-AGENT-TEST.md` | 1 | 高。适合作为 Baker Desk 回归测试、快捷示例和 AI 提示样例。 |
| 知识卡 | `data/recipe-library/baker/knowledge/*.md` | 12 | 高。已基本迁入 Baker Desk 技法库。 |
| 示例配方 | `data/recipe-library/baker/_md/example-brioche.md` | 1 | 中。已迁入；可作为导入格式样板。 |
| Python CLI | `scripts/bakers_percent.py` | 1 | 中。核心能力已用 TypeScript 重写；仍可对照边界行为。 |
| README | `README.md` | 1 | 高。包含配方格式、Baker's % 概念、CLI 用法和版权边界。 |
| License | `LICENSE` | 1 | 必须保留。MIT。 |

## 源仓库没有包含的内容

README 和 `agents/baker.md` 提到以下大规模配方目录：

- `_md/glm/intermediate/`：说明里写 60 个中级配方。
- `_md/glm/`：说明里写 139 个 GLM 转换配方。
- `_md/`：说明里写 97 个 OCR 配方。

但当前公开仓库没有这些文件。README 明确说明：`The recipe files in _md/ are not included in this repository.` 因此 Baker Desk 不能假设源仓库有完整 LCB 配方库；只能使用公开的知识卡、示例、脚本和测试题。

小红书视频对这个判断没有推翻：它证明作者宣传的是这个 GitHub 项目本身，但公开页面没有给出完整配方数据包。视频中的“文件夹”更像是 agent 项目文件夹，而不是完整课程配方数据库。

## 已迁入 Baker Desk 的内容

| 源内容 | Baker Desk 当前状态 |
| --- | --- |
| 12 张技法知识卡 | 已迁入，并额外增加了替代、模具、烤箱、曲奇、松饼、故障排查等扩展卡。 |
| `example-brioche.md` | 已迁入为可计算配方。 |
| Baker's % 解析与缩放逻辑 | 已在 `src/bakerCore.ts` 用 TypeScript 重写，并支持界面交互。 |
| 测试题库 | 已补入 `baker-agent-test-questions.md` 归档卡，并扩展回归测试。 |
| Agent 路由思路 | 部分迁入聊天规则和 AI prompt，但还可以系统化。 |
| README 配方格式 | 部分体现在录入规则；还可以整理成更完整的内置帮助卡。 |

## 仍值得继续吸收的内容

1. Agent 工作流

把 `agents/baker.md` 里的“先找配方、再读文件、再算百分比、再解释异常”做成 Baker Desk 内部回答流程说明。尤其是：

- Recipe lookup / calculation 和 Technique / science question 的分流。
- 技法问题对应知识卡的映射表。
- 配方质量等级和搜索顺序。
- 遇到 OCR 或数量异常时要提醒用户核对。

2. README 配方格式规范

可以做成录入页的“格式说明/示例模板”：

- frontmatter 字段解释：`titre`、`niveau`、`source`、`source_file`。
- bilingual table 是推荐格式。
- bullet list 是可解析但较弱的格式。
- Baker's % 默认基准：面包/塔/布里欧修用面粉，甘那许用巧克力，奶油类用最大组成。

3. 测试题库继续产品化

当前已经放回知识卡和测试。下一步可以做成：

- “测试题/练习题”页面。
- 一键把某道题送入对话框。
- 标记“常用问题”和“找茬问题”。
- 用它作为每次打包前的固定 smoke test。

4. Python CLI 的边界行为

当前 TypeScript 版本已经覆盖主要逻辑，包括范围数量取中值、单位换算、表格/列表解析、基准原料选择。仍可对照：

- `--find` 的目录优先级。
- `--ingredient` 的全文搜索方式。
- 非数字数量 `QS`、`1 gousse` 的忽略策略。

## 不建议迁入或不能迁入的内容

- 不要把 README 里提到但仓库未包含的 60/139/97 个配方当作已拥有内容。
- 不要伪造 Valencia、Passionata、Jamaica 等库内实例的完整配方；如果只有知识卡引用，应显示为“待导入引用”。
- 不要把源仓库说明中的 LCB 配方规模写成 Baker Desk 已内置规模。

## 建议优先级

1. 完成 Agent 工作流迁入：让 AI prompt 和本地规则都按同一套“检索 -> 计算 -> 解释 -> 警告”流程走。
2. 把 README 配方格式整理成录入页帮助卡。
3. 做一个“测试题库/练习题”视图或快捷抽题入口。
4. 保留 Python 脚本作为行为参考，不直接随软件暴露给普通用户。
