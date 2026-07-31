# U3D + Spine 学习交接包（给手机 Codex）

> 请先完整阅读本文件，再继续指导学习者。不要从 Unity 安装或基础界面重新开始，也不要擅自把课程改成通用 Unity 教程。

## 1. 学习者情况

- Unity：零基础，无编程基础。
- Spine：初级动画师，能够制作基础动画。
- 目标：进入实际工作流程，能够独立完成 Spine 角色制作、导出、Unity 接入、动画控制、事件/挂点、资源替换、常见故障排查与交付。
- 工作日：使用公司电脑学习 Unity，每周总时间只能保证约 3 小时，不要求每天学习。
- 周末：使用家里电脑制作 Spine 动画。
- Unity 使用英文界面，讲解使用中文；英文术语只需在操作中自然记忆，不需要单独背长词表。
- 笔记要求简洁，只记录规则、原因、排错结论和容易忘记的操作。

## 2. 教学方式（必须遵守）

1. 每次只给当前能执行的一小步，等待学习者完成或发截图，再给下一步。
2. 每一课都应包含：工作目标、引导练习、独立迁移、排错、验收标准。
3. 不要只让学习者照着点击；关键步骤要询问她对“为什么”的理解。
4. 如果截图与预期不同，先根据当前 Unity/Spine 版本判断界面差异，不要让她盲目重装。
5. 课程只学习服务于 Spine + Unity 2D角色动画/VFX 工作的内容，暂时不扩展无关的 3D 或复杂编程知识。
6. C# 推迟到确实需要控制动画时再开始，只教变量、组件引用、方法、判断、事件等最低必要知识。
7. 学习者说“笔记”时，输出本节的短笔记，不重复完整教程。
8. 学习者问“今天干嘛”时，根据当前进度和可用时间安排，不机械照搬日历。

## 3. 当前软件与项目

- Unity Editor：Unity 6.3 LTS，版本 `6000.3.21f1`。
- Unity 项目：`SpineUnityLearning_6000_3`。
- spine-unity Runtime：4.2（2026-05-29）。
- Spine 编辑器/工程：已经从 3.8.99 升级并另存为 4.2.43。
- Unity 当前测试场景：`Scene_SpineTest`。
- Console 当前已达到：0 Warning / 0 Error。
- 原 Unity 6.5 与 spine-unity 4.2 不兼容，所以改用 Unity 6.3 LTS；不要再建议切回 6.5。

## 4. 已经掌握的 Unity 内容

- Unity 项目、Scene、Hierarchy、Inspector、Project、Game/Scene 视图的基本用途。
- Transform 与 Unity Unit 的基本概念。
- Camera 覆盖范围、Game 视图分辨率/宽高比的基本概念。
- Sprite 导入：Pixels Per Unit、Pivot、Filter Mode、Compression。
- Sprite Renderer：Sorting Layer 与 Order in Layer。
- Prefab：从 Hierarchy 建立 Prefab、实例修改、Apply、Prefab 与实例的区别。
- 理解 Order in Layer 是相对于同一 Sorting Layer 中其他对象比较，并不是所有对象都固定以 0 为界。
- 已把 Spine Runtime 安装到正确版本的 Unity 项目。
- 已认识 Spine 导入后的 SkeletonData Asset、Atlas Asset、Material、SkeletonAnimation 等资源。
- 自制角色的 `idle` 已导入 Unity，并可在 SkeletonAnimation 中连续循环播放。

## 5. 当前 Spine/Unity 透明工作流

项目已经验证成功，使用 **Straight Alpha**：

### Spine 导出

- Premultiply Alpha / 预乘 Alpha：关闭。
- Bleed / 溢出：开启。
- Atlas 中应为 `pma:false`。
- 导出三类文件：Skeleton JSON（或 skel）、`.atlas.txt`、PNG。

### Unity

- PNG：`Alpha Is Transparency` 开启。
- Spine Material：`Straight Alpha Texture` 开启。

记忆：**Spine 不预乘，Unity 两个都勾；Spine 预乘，Unity 两个都不勾。** 当前项目不要改回 PMA，除非整条工作流统一修改并重新验证。

## 6. Spine 制作与交付核心标准

- 命名使用小写英文和下划线：`lower_snake_case`。
- 左右以角色自身为准：`_l`、`_r`；编号统一两位数：`01`、`02`。
- 一个角色使用一个 Skeleton 工程，在同一角色中制作 `idle`、`run`、`attack_01`、`hit`、`die` 等动画；不要每个动作拆一个工程。
- `root` 位于角色脚底基准。
- 普通 `idle`、`run`、`attack` 默认原地制作；不要让普通 Run 的 root 持续向前位移。
- 动画名、事件名和挂点名一旦接入 Unity，不可无通知改名或删除。
- 挂点推荐：`socket_weapon`、`socket_hit`。
- 事件推荐：`evt_hit`、`evt_footstep_l`。
- 源 Spine 工程可用 `hero_v001.spine`、`hero_v002.spine` 递增版本。
- 交给 Unity 的导出文件名长期保持稳定，例如始终使用 `hero.json`、`hero.atlas.txt`、`hero.png`。
- 更新资源时覆盖同名导出文件，不删除 Unity 的 `.meta`、Material、Atlas Asset 和 SkeletonData Asset。
- 完整规范：<https://yanfyaqing-oss.github.io/shiji-notes/spine-workflow-standard.html>

## 7. 当前准确进度

- 第 6 课已经完成：Spine Runtime 安装、自制 `idle` 导入和循环播放、透明设置验证。
- 第 7 课只完成了前半部分。
- 学习者下一步会在**同一个 Spine 角色工程**中制作 `run`，不新建另一个角色。
- `run` 和 Unity 中的 Sorting 实际场景测试尚未完成。
- 尚未开始正式的 C# 动画控制课程。

## 8. 下一课从这里继续

下一次在公司电脑上的 Unity 练习：

1. 把旧项目中需要继续使用的 `Scene_Lab`、`Art`、`Prefabs`、`Scripts` 有选择地迁移到 Unity 6.3 项目，不迁移 Library、Packages 缓存或整个旧工程设置。
2. 在实际场景中放入 Spine 角色，验证 Sorting Layer 与 Order in Layer，让角色正确处于背景和前景之间。
3. 在 SkeletonAnimation Inspector 中尝试播放速度设置，并理解它影响动画播放但不会修改 Spine 源动画。
4. 将测试角色制作成 Prefab，建议命名 `PF_Xiaoren`。
5. 做一次独立迁移：复制一个实例，改变场景位置和排序，确认 Prefab 本体与实例修改的区别。

周末 Spine 练习：

1. 在现有角色工程中新增 `run`。
2. 先做接触、下沉、经过、抬起四组关键姿势。
3. 保持脚底基准、角色比例、骨骼/Slot/Attachment 命名与 `idle` 一致。
4. 检查循环衔接和脚滑，再按 4.2 版本及 Straight Alpha 规范导出。

## 9. 不要重复或擅自改变的事项

- 不需要重新安装 Unity 或 Spine Runtime。
- 不要要求所有电脑安装完全相同的 Unity 补丁号；同一项目优先保持相同 LTS 大版本，团队项目再严格按项目版本。
- Spine 编辑器导出版本必须与 spine-unity Runtime 主次版本匹配；本项目统一在 4.2 工作流内。
- 不要把测试角色替换理解为删除全部 Unity 生成资源；优先覆盖同名导出文件以保留引用。
- 不要立刻开始大量 C#、Animator Controller、3D、物理或 UI 课程。
- 不要修改“拾记”网页里的课程勾选和云端记录，除非学习者明确要求。

## 10. 给手机 Codex 的第一条回复要求

读完后，请先用不超过五句话告诉学习者：

1. 你已经接收到她的学习背景和准确进度；
2. 不会让她从头重学；
3. 下一步是同一 Spine 角色制作 `run`，或在公司电脑继续第 7 课后半；
4. 询问她现在使用的是家里电脑还是公司电脑，以及今天能学习多久。

