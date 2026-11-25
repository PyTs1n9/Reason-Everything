import assert from "node:assert/strict";
import { test } from "node:test";

import { countPaperChars, joinPaperLines, paragraphizePage } from "../src/web/model.ts";

test("折行合并：中文不插空格，英文补空格，连字符保留", () => {
  assert.equal(joinPaperLines(["左栏第一段。本文用于检验 PDF", "文字层在多栏排版"]), "左栏第一段。本文用于检验 PDF文字层在多栏排版");
  assert.equal(joinPaperLines(["The results were observed", "only on short documents."]), "The results were observed only on short documents.");
  assert.equal(joinPaperLines(["采用 5-", "way 1-shot 设置"]), "采用 5-way 1-shot 设置");
  assert.equal(joinPaperLines(["classi-", "fication"]), "classi-fication");
  assert.equal(joinPaperLines(["结论如下：", "其一，检索有效。"]), "结论如下：其一，检索有效。");
});

test("段落还原：空行断段，页眉与章节标题各自成块", () => {
  const page = [
    "第 24 卷第 3 期",
    "2024 年 6 月",
    "",
    "基于证据检索的少样本视觉分类方法",
    "",
    "1  引 言",
    "深度卷积网络在大规模标注数据上取得了显著进展，但其性能高度依赖数据规模。",
    "在医学影像等场景中，获取大量标注样本的成本极高。",
    "",
    "2  方法",
    "本文提出基于证据检索的框架。",
  ].join("\n");
  assert.deepEqual(paragraphizePage(page, { firstPage: true }), [
    { kind: "meta", text: "第 24 卷第 3 期 · 2024 年 6 月" },
    { kind: "title", text: "基于证据检索的少样本视觉分类方法" },
    { kind: "heading", text: "1 引 言" },
    { kind: "body", text: "深度卷积网络在大规模标注数据上取得了显著进展，但其性能高度依赖数据规模。在医学影像等场景中，获取大量标注样本的成本极高。" },
    { kind: "heading", text: "2 方法" },
    { kind: "body", text: "本文提出基于证据检索的框架。" },
  ]);
});

test("段落还原：无空行的折行页合并为一整段，不把每行当一段", () => {
  const page = [
    "左栏第一段。本文用于检验 PDF 文字层在多栏排版",
    "下的读取顺序是否与人的阅读顺序一致。若提取结",
    "果把左右栏交错拼接，则正文会出现语义断裂。",
  ].join("\n");
  assert.deepEqual(paragraphizePage(page), [
    {
      kind: "body",
      text: "左栏第一段。本文用于检验 PDF 文字层在多栏排版下的读取顺序是否与人的阅读顺序一致。若提取结果把左右栏交错拼接，则正文会出现语义断裂。",
    },
  ]);
});

test("段落还原：超长整栏按句末切成阅读块，块内不截断句子", () => {
  const sentence = "检索机制在支持集含遮挡样本时带来稳定增益，但在干净支持集上的作用仍需进一步验证。";
  const page = sentence.repeat(12);
  const blocks = paragraphizePage(page);
  assert.ok(blocks.length > 1, "长栏应切成多块");
  for (const block of blocks) {
    assert.equal(block.kind, "body");
    assert.match(block.text, /。$/, "每块以完整句子收尾");
    assert.ok(Array.from(block.text).length <= 460);
  }
  assert.equal(blocks.map((block) => block.text).join(""), page);
});

test("段落还原：刊名/卷期/作者并入页眉，不被误当成论文标题", () => {
  const page = [
    "第 24 卷第 3 期",
    "2024 年 6 月",
    "中国图象图形学报",
    "Journal of Image and Graphics",
    "Vol. 24, No. 3",
    "June 2024",
    "",
    "基于证据检索的少样本视觉分类方法",
    "",
    "张 明  李思远  王 琳",
    "（浙江大学 计算机科学与技术学院，杭州 310027）",
    "",
    "摘  要：少样本视觉分类要求在每类仅有少量标注样本的条件下识别新类别。",
    "关键词：少样本学习；视觉分类；证据检索",
    "Evidence-Retrieval Few-Shot Visual Classification",
  ].join("\n");
  const blocks = paragraphizePage(page, { firstPage: true });
  assert.equal(blocks[0]?.kind, "meta");
  assert.match(blocks[0]!.text, /中国图象图形学报/);
  const title = blocks.find((block) => block.kind === "title");
  assert.equal(title?.text, "基于证据检索的少样本视觉分类方法");
  assert.equal(blocks.find((block) => block.text.startsWith("关键词"))?.kind, "body", "关键词属于正文，不得提升为标题");
  assert.equal(blocks.find((block) => block.text.startsWith("Evidence-Retrieval"))?.kind, "meta", "英文题名归版头");
  assert.ok(blocks.some((block) => block.kind === "meta" && block.text.includes("张 明")));
  assert.ok(blocks.some((block) => block.kind === "body" && block.text.startsWith("摘 要：")));
});

test("段落还原：空页返回空数组，扫描页不编造内容", () => {
  assert.deepEqual(paragraphizePage(""), []);
  assert.deepEqual(paragraphizePage("\n  \n"), []);
});

test("首行标题只在首页提升，正文句末不误判", () => {
  const page = "本文提出基于证据检索的框架。\n\n第二段。";
  assert.deepEqual(paragraphizePage(page, { firstPage: true })[0], {
    kind: "body",
    text: "本文提出基于证据检索的框架。",
  });
});

test("字数统计：汉字按字、拉丁按词、标点不计", () => {
  assert.equal(countPaperChars("检索模块贡献 2.1 个百分点。"), 11);
  assert.equal(countPaperChars("The results were observed only on short documents."), 8);
  assert.equal(countPaperChars(""), 0);
});
