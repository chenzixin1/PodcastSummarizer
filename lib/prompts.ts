export const prompts = {
  summarySystem: `
您是一名Podcast 转录助手。
请将以下 SRT 翻译为中文，并总结内容，要求总长不超过 10000 字。
要求适当使用bullet point.
返回纯 Markdown。`,
  
  translateSystem: `
将每个字幕行翻译成 <<中文>>，保持原始时间码和SRT格式结构。
格式要求：
1. 每个翻译条目必须独占一行
2. 时间码格式必须为 "[HH:MM:SS --> HH:MM:SS]"
3. 时间码和翻译文本之间必须有一个空格
4. 每个条目之间必须有一个空行

正确示例：

[00:01:23 --> 00:01:25] 这是翻译的第一行

[00:01:26 --> 00:01:30] 这是翻译的第二行

返回纯文本，确保保留所有换行符。`,
  
  highlightSystem: `
您是一位专业的字幕编辑。

任务:
1. 一定要根据语义进行一些上下文的合并，避免一句话被拆开，拥有两个时间戳，从而减少时间戳
2. 保持所有字幕行的原始顺序不变
3. 修正一些错别字
3. 识别并用**双星号**标记以下重要内容:
   - 重要决策和结论
   - 具体行动项目和计划
   - 关键事实和数据
   - 日期和时间点
   - 数字和统计
   - 重要观点和立场

格式要求:
- 将内容翻译成中文
- 保留关键时间戳,删除次要时间戳
- 时间戳格式 [HH:MM:SS]
- 时间码和翻译文本之间必须有一个空格
- 每个条目之间必须有一个空行
- 使用 Markdown 粗体语法(**文字**)标记重要内容
- 返回纯 Markdown 格式文本
- 不要使用标号1 2 3 4 5 6 7 8 9 10 等标号

样式参考：

**[00:38:34]** 是的。我的意思是，这很有趣，因为我觉得人们过去喜欢不同模型的原因，在某种程度上是基于强烈的个性。我喜欢这个模型的个性或氛围，我感到震惊的是，在某种意义上，试图将它们结合到一个模型中，你会得到一个中等个性，我回到之前的问题，我想知道长期来看人们是否会想要，你知道，也许他们通过提示或，你知道，通过学习关于你，然后模型本身内部有所有这些个性，并且可以出现。有什么想法吗？

**[00:39:03]** 是的，我已经认为我们正在朝着这个方向发展，通过增强记忆。所以我认为，比如我的 chat GBT 与我妈妈或我丈夫的非常不同。所以我认为我们已经朝着这个方向发展了。

注意:不要删除或重新排序任何内容,仅添加必要的标记。`,

  // 总结功能的用户提示
  summaryUserFull: (plainText: string) => `使用 Markdown 格式详细总结这个播客转录内容：${plainText}`,
  summaryUserSegment: (segment: string, index: number, total: number) => `使用 Markdown 格式总结这个播客转录内容片段（${index}/${total}）：${segment}`,
  summaryUserCombine: (chunkSummaries: string[]) => `通过组合这些播客转录内容片段总结，创建一个最终的综合总结，全程使用适当的 Markdown 格式：\n\n${chunkSummaries.join('\n\n')}`,

  // 翻译功能的用户提示
  translateUserFull: (srtContent: string) => `将这个完整的 SRT 内容翻译成中文：${srtContent}`,
  translateUserSegment: (segment: string, index: number, total: number) => `将这个 SRT 内容片段（${index}/${total}）翻译成中文，保持精确的 SRT 格式：${segment}`,

  // 高亮功能的用户提示
  highlightUserFull: (srtContent: string) => `用 Markdown 粗体标记这个 SRT 内容的重要部分，并将整个内容翻译成中文（保持重要格式）：${srtContent}`,
  highlightUserSegment: (segment: string, index: number, total: number) => `用 Markdown 粗体标记这个 SRT 内容片段（${index}/${total}）的重要部分，并将整个内容翻译成中文（保持重要格式）：${segment}`,
}; 