/** Display-only reading cues. These are lexical signals, not a generated summary.
 * Work on parsed text so Markdown, source strings and pronunciation links stay intact.
 */
type ReadingNode = { type: string; value?: string; url?: string; children?: ReadingNode[] };

// Same families as the existing summary cues, with explicit Chinese terms rather
// than a greedy suffix regex which can accidentally bold an entire Chinese clause.
const SIGNAL = /(?:\b(?:reinforcement learning|continual learning|in-context learning|machine learning|deep learning|artificial intelligence|large language models?|model weights?|context windows?|sample efficiency|computational power|AI agents?|verifiable tasks?|pretraining|alignment|deployment|OpenAI|Anthropic|ChatGPT|Hugging Face|cash flow|profit margins?|interest rates?|supply chains?|clinical trials?|risk management|action items?|deadlines?|revenue|inflation)\b|\b[A-Z][A-Z0-9]{1,7}\b|人工智能|强化学习|持续学习|上下文学习|机器学习|深度学习|大语言模型|语言模型|模型能力|模型权重|训练数据|安全案例|安全评估|安全保障|安全风险|安全对齐|预训练|泛化能力|计算能力|计算资源|样本效率|上下文窗口|多模态|对齐|现金流|利润率|营业收入|供应链|临床试验|风险管理|行动事项|截止日期|通货膨胀|\b\d+(?:[,.]\d+)*(?:\s?(?:%|percent\b|million\b|billion\b|trillion\b|years?\b|months?\b)|(?:万|亿|倍|年|个月)))/gi;

function textLength(node: ReadingNode): number {
  return node.value?.length ?? node.children?.reduce((sum, child) => sum + textLength(child), 0) ?? 0;
}

export function remarkReadingEmphasis() {
  return (tree: ReadingNode) => {
    const processParagraph = (paragraph: ReadingNode) => {
      const budget = Math.max(8, Math.floor(textLength(paragraph) * 0.18));
      let used = 0;
      let count = 0;
      const seen = new Set<string>();
      const walk = (node: ReadingNode) => {
        if (!node.children) return;
        // Existing editorial emphasis is authoritative; never nest <strong>.
        if (['strong', 'code', 'inlineCode', 'html', 'image', 'heading'].includes(node.type)) return;
        // Preserve ordinary links and timestamps; vocabulary links retain their
        // original href and event handler, and may contain a highlighted term.
        if (node.type === 'link' && !node.url?.startsWith('#pronounce:')) return;
        node.children = node.children.flatMap(child => {
          if (child.type !== 'text' || !child.value) { walk(child); return [child]; }
          const text = child.value;
          const result: ReadingNode[] = [];
          let cursor = 0;
          for (const match of text.matchAll(SIGNAL)) {
            const term = match[0];
            // /i supports natural-case phrases, but do not treat all short words
            // as acronyms. Require actual uppercase letters for this category.
            if (/^[a-z0-9]{2,8}$/i.test(term) && !/^[A-Z][A-Z0-9]{1,7}$/.test(term) && !/^(alignment|OpenAI|ChatGPT|deadline|revenue)$/i.test(term)) continue;
            const key = term.toLowerCase();
            if (seen.has(key) || count >= 6 || used + term.length > budget) continue;
            const start = match.index!;
            result.push({ type: 'text', value: text.slice(cursor, start) }, { type: 'strong', children: [{ type: 'text', value: term }] });
            cursor = start + term.length;
            seen.add(key); used += term.length; count += 1;
          }
          if (!result.length) return [child];
          result.push({ type: 'text', value: text.slice(cursor) });
          return result;
        });
      };
      walk(paragraph);
    };
    const visit = (node: ReadingNode) => {
      if (node.type === 'paragraph') { processParagraph(node); return; }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
