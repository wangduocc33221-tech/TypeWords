import { get } from "idb-keyval";
import { Candidate, Question, Word } from "../types";
import { shuffle } from "../utils";

const CHARS_CONTAIN_SCORE = 1 << 2;
const CHARS_NOT_CONTAIN_SCORE = -1;
const TRAN_EQUALS_BASE_SCORE = 1 << 16;
const TRANS_CHARS_COMMON_FACTOR = 1;
const WORD_COMMON_FACTOR = 1 << 16;
const WORD_CONTAIN_SCORE = 1 << 20;
const FUZZ_SCORE_BASE = 1 << 18;

function getTrans(word: Word): { cn: string, freq: number }[] {
    let rsMap = new Map<string, { cn: string, freq: number }>();
    word.trans.forEach(item => {
        let target = rsMap.get(item.cn);
        if (target) {
            target.freq += item.frequency || 0;
            rsMap.set(item.cn, target);
        } else {
            rsMap.set(item.cn, { cn: item.cn, freq: item.frequency || 0 });
        }
    })
    return Array.from(rsMap.values());
}

function calCommon(str1: string, str2: string): number {
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();
    let rs = 0;
    let set1 = new Set(str1.split(''));
    let set2 = new Set(str2.split(''));
    for (let char of set1) {
        if (set2.has(char)) {
            rs += CHARS_CONTAIN_SCORE;
        } else {
            rs += CHARS_NOT_CONTAIN_SCORE;
        }
    }
    for (let char of set2) {
        if (set1.has(char)) {
            rs += CHARS_CONTAIN_SCORE;
        } else {
            rs += CHARS_NOT_CONTAIN_SCORE;
        }
    }
    return rs;
}

function calSimilarity(word1: Word, word2: Word): number {
    if (word2.trans.length < word1.trans.length) {
        [word1, word2] = [word2, word1];
    }
    let word1Trans = getTrans(word1);
    let word2Trans = getTrans(word2);
    let word2TransMap = new Map(word2Trans.map(item => [item.cn, item]));

    let similarity = 0;
    word1Trans.forEach((item) => {
        let item2 = word2TransMap.get(item.cn);
        if (item2) {
            const freq1 = item.freq;
            const freq2 = item2.freq;
            similarity += (freq1 * freq2) * TRAN_EQUALS_BASE_SCORE;
        }
    })

    similarity += calCommon(word1Trans.map(item => item.cn).join(''), word2Trans.map((item) => item.cn).join('')) * TRANS_CHARS_COMMON_FACTOR;
    similarity += calCommon(word1.word, word2.word) * WORD_COMMON_FACTOR;
    if (
        word1.word.includes(word2.word) ||
        word2.word.includes(word1.word)
    ) {
        similarity += WORD_CONTAIN_SCORE;
    }
    if (
        word1.relWords.rels.findIndex(rel => rel.words.findIndex(word => word.c === word2.word) !== -1) !== -1 ||
        word2.relWords.rels.findIndex(rel => rel.words.findIndex(word => word.c === word1.word) !== -1) !== -1
    ) {
        similarity += WORD_CONTAIN_SCORE;
        // console.log('relWords', word1.word, word2.word)
    }
    return similarity + Math.pow(Math.random(), 2) * FUZZ_SCORE_BASE;
}

export function buildQuestion(word: Word, list: Word[], maxCount: number = 4): Question {
    let similarityList: { word: Word, similarity: number }[] = []
    for (let i = 0; i < list.length; i++) {
        const item = list[i]

        const wordStr = word.word.toLowerCase()
        const itemStr = item.word.toLowerCase()
        if (wordStr === itemStr) continue

        if (word.trans.map(t => t.cn).join('') === item.trans.map(t => t.cn).join('')) continue

        const similarity = calSimilarity(word, item)
        similarityList.push({ word: item, similarity })
    }
    similarityList.sort((a, b) => a.similarity - b.similarity)

    let candidates = similarityList.slice(-(Math.min(maxCount - 1, similarityList.length))).map(v => ({ word: v.word, similarity: v.similarity }))
    candidates.push({ word: word, similarity: Infinity })
    candidates = shuffle(candidates)
    // console.log(candidates)
    const correctIndex = candidates.findIndex(v => v.word === word)
    return {
        candidates,
        correctIndex,
    }
}
/**
 * 模式3专用：给例句生成4选1 paraphrase题目
 * @param word 当前单词
 * @param list 当前词表所有单词（用来抽干扰项）
 * @param maxCount 选项数量，默认4个
 */
export function buildParaphraseQuestion(word: Word, list: Word[], maxCount: number = 4): Question {
  // 1. 确定正确答案：优先用你加的paraphrase英文释义，没有就兜底用第一个中文释义
  const correctText = word.paraphrase || word.trans[0]?.cn || ''
  // 用来存已经用过的选项文本，避免重复
  const usedTexts = new Set([correctText])
  const candidates: Candidate[] = [{ word, similarity: Infinity }]

  // 2. 遍历词表，复用原来的相似度逻辑，抽最相似的3个干扰项
  const similarityList: { word: Word; similarity: number }[] = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    // 跳过当前单词本身
    if (item.word.toLowerCase() === word.word.toLowerCase()) continue
    // 取当前干扰项的文本：优先paraphrase，没有就用中文释义
    const itemText = item.paraphrase || item.trans[0]?.cn || ''
    // 跳过空文本、重复文本
    if (!itemText || usedTexts.has(itemText)) continue
    // 复用原来的相似度计算，选最容易混淆的释义当干扰项
    const similarity = calSimilarity(word, item)
    similarityList.push({ word: item, similarity })
  }

  // 3. 取相似度最高的3个当干扰项
  similarityList.sort((a, b) => b.similarity - a.similarity)
  const wrongCandidates = similarityList.slice(0, maxCount - 1)
  wrongCandidates.forEach(c => {
    const text = c.word.paraphrase || c.word.trans[0]?.cn
    usedTexts.add(text)
    candidates.push(c)
  })

  // 4. 打乱选项顺序，返回和原来完全一样的Question结构，不用改类型
  const shuffledCandidates = shuffle(candidates)
  const correctIndex = shuffledCandidates.findIndex(c => c.word === word)
  return {
    candidates: shuffledCandidates,
    correctIndex
  }
}
