<script setup lang="ts">
import type { Question, Word } from '../../types'
import { getDefaultWord, IdentifyMethod, ShortcutKey, WordPracticeType } from '../../types'
import { useBaseStore, useSettingStore } from '../../stores'
import {
  cancelWordPracticeAudio,
  resetActiveWordPlayCount,
  usePlayBeep,
  usePlayCorrect,
  usePlayKeyboardAudio,
} from '../../hooks/sound'
import { WordPlayTrigger, useWordPracticeAudio } from '../../composables/useWordPracticeAudio'
import { emitter, EventKey, useEventsByWatch } from '../../utils/eventBus'
import { computed, onMounted, onUnmounted, toRef, watch } from 'vue'
import SentenceHightLightWord from './SentenceHightLightWord.vue'
import ClickableEnglishText from './ClickableEnglishText.vue'
import ClickableWord from './ClickableWord.vue'
import WordLookupPopover from './WordLookupPopover.vue'
import { _nextTick, last, normalizeWord, useNav } from '../../utils'
import { BaseButton, BaseIcon, Textarea, Toast, ToastComponent, Tooltip, VolumeIcon } from '@typewords/base'
import Space from '../article/Space.vue'
import { useI18n } from 'vue-i18n'
import { useWordOptions } from '../../hooks/dict.ts'
import { openWordCollectPicker } from '../../hooks/useWordCollectPicker.ts'
import { ref } from 'vue'
import TranslationList from './TranslationList.vue'
import { useOnKeyboardEventListener } from '../../hooks/event.ts'

const SENTENCE_PLAY_SHORTCUT_KEYS = [
  ShortcutKey.PlaySentence1,
  ShortcutKey.PlaySentence2,
  ShortcutKey.PlaySentence3,
  ShortcutKey.PlaySentence4,
  ShortcutKey.PlaySentence5,
  ShortcutKey.PlaySentence6,
  ShortcutKey.PlaySentence7,
  ShortcutKey.PlaySentence8,
  ShortcutKey.PlaySentence9,
] as const

const { t: $t } = useI18n()

interface IProps {
  word: Word
  question?: Question
}

const props = withDefaults(defineProps<IProps>(), {
  word: () => getDefaultWord(),
})

const emit = defineEmits<{
  complete: []
  wrong: []
  know: []
  mastered: []
  skip: []
  toggleSimple: []
}>()

let input = $ref('')
let wrong = $ref('')
let showFullWord = $ref(false)
let showWordResult = ref(false)
//错误次数
let wrongTimes = ref(0)
//输入锁定，因为跳转到下一个单词有延时，如果重复在延时期间内重复输入，导致会跳转N次
let inputLock = false
let waitClear = false
let wordRepeatCount = 0
// 记录单词完成的时间戳，用于防止同时按下最后一个字母和空格键时跳过单词
let wordCompletedTime = 0
let jumpTimer: ReturnType<typeof setTimeout> | null = null
let cursor = $ref({
  top: 0,
  left: 0,
})
const settingStore = useSettingStore()
const store = useBaseStore()

const playBeep = usePlayBeep()
const playCorrect = usePlayCorrect()
const playKeyboardAudio = usePlayKeyboardAudio()

const volumeIconRef: any = $ref()
const sentenceVolumeIconsRefs: any = $ref([])

const canSeeSentences = computed(
  () =>
    ![WordPracticeType.Listen, WordPracticeType.Dictation, WordPracticeType.Identify].includes(
      settingStore.wordPracticeType
    ) ||
    showFullWord ||
    showWordResult.value
)

const { highlightedSentenceIndex, playWord, playSentence, playTtsWithGuide } = useWordPracticeAudio({
  word: toRef(props, 'word'),
  volumeIconRef: computed(() => volumeIconRef),
  canSeeSentences: () => canSeeSentences.value,
})

function getSentenceShortcut(index: number) {
  const key = SENTENCE_PLAY_SHORTCUT_KEYS[index]
  return key ? settingStore.shortcutKeyMap[key] : ''
}
const typingWordRef = $ref<HTMLDivElement>()
// const volumeTranslateIconRef: any = $ref()

let showAllCandidates = $ref(false)
let editingNote = $ref(false)
let noteInputValue = $ref('')

let displayWord = $computed(() => {
  return props.word.word.slice(input.length + wrong.length)
})
let displaySentence = $computed(() => {
  return props.word.sentences[currentPracticeSentenceIndex].c.slice(input.length + wrong.length)
})

let isSelfAssessment = $computed(() => {
  return (
    settingStore.wordPracticeType === WordPracticeType.Identify &&
    settingStore.identifyMethod === IdentifyMethod.SelfAssessment
  )
})

let isWordTest = $computed(() => {
  return (
    settingStore.wordPracticeType === WordPracticeType.Identify &&
    settingStore.identifyMethod === IdentifyMethod.WordTest
  )
})

// 在全局对象中存储当前单词信息，以便其他模块可以访问
function updateCurrentWordInfo() {
  window.__CURRENT_WORD_INFO__ = {
    word: props.word.word,
    input: input,
    inputLock: inputLock,
    containsSpace: props.word.word.includes(' '),
  }
}

watch(
  () => props.word,
  () => resetState(WordPlayTrigger.NewWord)
)

function resetState(trigger: WordPlayTrigger) {
  clearJumpTimer()
  cancelWordPracticeAudio()
  wrong = input = ''
  wordRepeatCount = 0
  showWordResult.value = inputLock = completeSelect = showAllCandidates = false
  editingNote = false
  noteInputValue = ''
  currentPracticeSentenceIndex = -1
  wordCompletedTime = 0
  wrongTimes.value = 0
  highlightedSentenceIndex.value = -1
  resetActiveWordPlayCount(props.word.word)
  if (settingStore.wordSound && settingStore.wordPracticeType !== WordPracticeType.Dictation) {
    playWord(trigger, { resetIcon: trigger === WordPlayTrigger.NewWord })
  }
  updateCurrentWordInfo()
  checkCursorPosition()
}

// 监听输入变化，更新当前单词信息
watch(
  () => input,
  () => {
    updateCurrentWordInfo()
  }
)

function onKeyUp(e: KeyboardEvent) {
  hideWord()
}

function onKeyDown(e: KeyboardEvent) {
  switch (e.key) {
    case 'Backspace':
      del()
      break
  }
}

useOnKeyboardEventListener(onKeyDown, onKeyUp)

onMounted(() => {
  // 初始化当前单词信息
  updateCurrentWordInfo()

  emitter.on(EventKey.resetWord, onResetWord)
  emitter.on(EventKey.onTyping, onTyping)
})

function onResetWord() {
  resetState(WordPlayTrigger.ResetSameWord)
}

onUnmounted(() => {
  clearJumpTimer()
  emitter.off(EventKey.resetWord, onResetWord)
  emitter.off(EventKey.onTyping, onTyping)
})

function clearJumpTimer() {
  if (!jumpTimer) {
    return
  }
  clearTimeout(jumpTimer)
  jumpTimer = null
}

function repeat() {
  setTimeout(() => {
    wrong = input = ''
    wordRepeatCount++
    inputLock = false

    if (settingStore.wordSound) playWord(WordPlayTrigger.RepeatWord)
  }, settingStore.waitTimeForChangeWord)
}

let pressNumber = 0

const right = $computed(() => {
  let a = input
  let b
  if (isTypingSentence()) {
    b = props.word.sentences[currentPracticeSentenceIndex].c
  } else {
    b = props.word.word
  }

  if (settingStore.wordPracticeType === WordPracticeType.Dictation) {
    a = normalizeWord(a)
    b = normalizeWord(b)
  }
  if (settingStore.ignoreCase) {
    return a.toLowerCase() === b.toLowerCase()
  } else {
    return a === b
  }
})

let showNotice = false

function know(e) {
  if (isSelfAssessment) {
    if (!showWordResult.value) {
      inputLock = showWordResult.value = true
      input = props.word.word
      emit('know')
      if (!showNotice) {
        Toast.info($t('know_word_tip'), { duration: 5000 })
        showNotice = true
      }
      return
    }
  }
  onTyping(e)
}

function mastered(e) {
  if (isSelfAssessment) {
    emit('mastered')
    return
  }
  onTyping(e)
}

function unknown(e) {
  if (isSelfAssessment) {
    if (!showWordResult.value) {
      showWordResult.value = true
      typo()
      if (settingStore.wordSound) playWord(WordPlayTrigger.RevealUnknown)
      return
    }
  }
  onTyping(e)
}

let selectIndex = $ref(-1)
let completeSelect = false
function select(e, index: number) {
  if (completeSelect) return
  if (isWordTest) {
    completeSelect = true
    selectIndex = index
    if (index == props?.question?.correctIndex) {
      input = props.word.word
      playCorrect()
      emit('know')
    } else {
      wrong = props.word.word
      playBeep()
      play()
      emit('wrong')
    }

    if (!showNotice) {
      Toast.info($t('press_space_continue'), { duration: 5000 })
      showNotice = true
    }
    return
  }
  onTyping(e)
}

let currentPracticeSentenceIndex = $ref(-1)

async function onTyping(e: KeyboardEvent) {
  if (waitClear) {
    return
  }

  if (isWordTest) {
    if (e.code === 'Space') {
      if (completeSelect) {
        completeTypeWord(false)
      } else {
        select(e, -1)
      }
    }
    return
  }

  // debugger
  let target
  let targetVolumeIcon
  if (isTypingSentence()) {
    target = props.word.sentences[currentPracticeSentenceIndex].c
    targetVolumeIcon = sentenceVolumeIconsRefs[currentPracticeSentenceIndex]
  } else {
    target = props.word.word
    targetVolumeIcon = volumeIconRef
  }
  // 输入完成会锁死不能再输入
  if (inputLock) {
    //判断是否是空格键以便切换到下一个
    if (e.code === 'Space') {
      //正确时就切换到下一个
      if (right) {
        clearJumpTimer()
        // 如果单词刚完成（300ms内），忽略空格键，避免同时按下最后一个字母和空格键时跳过
        // 手动模式使用独立的空格冷却时间设置
        const spaceCooldown = settingStore.autoNextWord
          ? settingStore.waitTimeForChangeWord
          : settingStore.spaceCooldownTime
        if (wordCompletedTime && Date.now() - wordCompletedTime < spaceCooldown) {
          return
        }
        completeTypeWord(false)
        showWordResult.value = inputLock = false
      } else {
        if (showWordResult.value) {
          // 错误时，提示用户按删除键，仅默写需要提示
          pressNumber++
          if (pressNumber >= 3) {
            Toast.info($t('press_delete_reinput'), { duration: 2000 })
            pressNumber = 0
          }
        }
      }
    } else {
      //当正确时，提醒用户按空格键切下一个
      if (right) {
        pressNumber++
        if (pressNumber >= 3) {
          Toast.info($t('press_space_continue'), { duration: 2000 })
          pressNumber = 0
        }
      } else {
        //当错误时，按任意键重新输入
        showWordResult.value = inputLock = false
        input = wrong = ''
        onTyping(e)
      }
    }
    return
  }
  inputLock = true
  let letter = e.key
  // console.log('letter',letter)
  //默写特殊逻辑
  if (settingStore.wordPracticeType === WordPracticeType.Dictation) {
    if (e.code === 'Space') {
      //如果输入长度大于单词长度/单词不包含空格，并且输入不为空（开始直接输入空格不行），则显示单词；
      // 这里inputLock 不设为 false，不能再输入了，只能删除（删除会重置 inputLock）或按空格切下一格
      if (input.length && (input.length >= target.length || !target.includes(' '))) {
        //比对是否一致
        if (right) {
          //如果已显示单词，则发射完成事件，并 return
          if (showWordResult.value) {
            return emit('complete')
          } else {
            //未显示单词，则播放正确音乐，并在后面设置为 showWordResult.value 为 true 来显示单词
            showWordResult.value = true
            playCorrect()
            if (settingStore.wordSound) {
              playWord(WordPlayTrigger.DictationReveal, { volumeRef: targetVolumeIcon })
            }
          }
        } else {
          //错误处理
          playBeep()
          showWordResult.value = true
          if (settingStore.wordSound) {
            playWord(WordPlayTrigger.DictationReveal, { volumeRef: targetVolumeIcon })
          }
          typo()
        }
        return
      }
    }
    //默写途中不判断是否正确，在按空格再判断
    input += letter
    wrong = ''
    playKeyboardAudio()
    updateCurrentWordInfo()
    inputLock = false
  } else if (settingStore.wordPracticeType === WordPracticeType.Identify && !showWordResult.value) {
    //当自测模式下，按其他键则自动默认为不认识
    showWordResult.value = true
    typo()
    if (settingStore.wordSound) {
      playWord(WordPlayTrigger.IdentifyWrongKey, { volumeRef: targetVolumeIcon })
    }
    inputLock = false
    onTyping(e)
  } else {
    let right = false
    console.log('letter', letter, target, input.length, target[input.length])
    if (settingStore.ignoreCase) {
      right = letter.toLowerCase() === target[input.length].toLowerCase()
    } else {
      right = letter === target[input.length]
    }
    //针对中文的特殊判断
    if (
      e.shiftKey &&
      (('！' === target[input.length] && e.code === 'Digit1') ||
        ('￥' === target[input.length] && e.code === 'Digit4') ||
        ('…' === target[input.length] && e.code === 'Digit6') ||
        ('（' === target[input.length] && e.code === 'Digit9') ||
        ('—' === target[input.length] && e.code === 'Minus') ||
        ('？' === target[input.length] && e.code === 'Slash') ||
        ('》' === target[input.length] && e.code === 'Period') ||
        ('《' === target[input.length] && e.code === 'Comma') ||
        ('“' === target[input.length] && e.code === 'Quote') ||
        ('”' === target[input.length] && e.code === 'Quote') ||
        ('：' === target[input.length] && e.code === 'Semicolon') ||
        ('）' === target[input.length] && e.code === 'Digit0'))
    ) {
      right = true
      letter = target[input.length]
    }
    if (
      !e.shiftKey &&
      (('、' === target[input.length] && e.code === 'Slash') ||
        ('。' === target[input.length] && e.code === 'Period') ||
        ('，' === target[input.length] && e.code === 'Comma') ||
        ('‘' === target[input.length] && e.code === 'Quote') ||
        ('’' === target[input.length] && e.code === 'Quote') ||
        ('；' === target[input.length] && e.code === 'Semicolon') ||
        ('【' === target[input.length] && e.code === 'BracketLeft') ||
        ('】' === target[input.length] && e.code === 'BracketRight'))
    ) {
      right = true
      letter = target[input.length]
    }
    // console.log('e', e, e.code, e.shiftKey, word[input.length])

    if (right) {
      input += letter
      wrong = ''
      playKeyboardAudio()
    } else {
      typo()
      wrong = letter
      playBeep()
      if (settingStore.wordSound) {
        playWord(WordPlayTrigger.Typo, { volumeRef: targetVolumeIcon })
      }
      waitClear = true
      setTimeout(() => {
        if (settingStore.inputWrongClear && !isTypingSentence()) input = ''
        wrong = ''
        waitClear = false
      }, 500)
    }
    // 更新当前单词信息
    updateCurrentWordInfo()
    //不需要把inputLock设为false，输入完成不能再输入了，只能删除，删除会打开锁
    if (input.toLowerCase() === target.toLowerCase()) {
      wordCompletedTime = Date.now() // 记录单词完成的时间戳
      playCorrect()
      if (
        [WordPracticeType.Listen, WordPracticeType.Identify].includes(settingStore.wordPracticeType) &&
        !showWordResult.value
      ) {
        showWordResult.value = true
      }
      if ([WordPracticeType.FollowWrite, WordPracticeType.Spell].includes(settingStore.wordPracticeType)) {
        if (settingStore.autoNextWord) {
          completeTypeWord(true)
        }
      }
    } else {
      //这里不要移动inputLock，否则输入完成时无法进入空格键的判断
      inputLock = false
    }
  }
}

function shouldRepeat() {
  if (settingStore.wordPracticeType === WordPracticeType.FollowWrite) {
    if (settingStore.repeatCount == 100) {
      return settingStore.repeatCustomCount > wordRepeatCount + 1
    } else {
      return settingStore.repeatCount > wordRepeatCount + 1
    }
  } else {
    return false
  }
}

function isTypingSentence() {
  return currentPracticeSentenceIndex !== -1
}

function completeTypeWord(delay: boolean) {
  if (settingStore.wordPracticeType === WordPracticeType.FollowWrite && settingStore.practiceSentence) {
    currentPracticeSentenceIndex++
    if (currentPracticeSentenceIndex < props.word.sentences.length) {
      // 还有下一个句子
      inputLock = false
      wrong = input = ''
      return
    }
  }
  if (shouldRepeat()) {
    repeat()
  } else {
    if (delay) {
      clearJumpTimer()
      jumpTimer = setTimeout(() => emit('complete'), settingStore.waitTimeForChangeWord)
    } else {
      emit('complete')
    }
  }
}

function del() {
  playKeyboardAudio()
  inputLock = false
  if (showWordResult.value) {
    input = ''
    showWordResult.value = false
    //如果是自测阶段，按删除键代码弄错了，需要标记为错词，同时从excludeWords里排除
    if (settingStore.wordPracticeType === WordPracticeType.Identify) {
      typo()
      if (settingStore.wordSound) playWord(WordPlayTrigger.DelRetry)
    }
  } else {
    if (wrong) {
      wrong = ''
    } else {
      input = input.slice(0, -1)
    }
  }
  // 更新当前单词信息
  updateCurrentWordInfo()
}

function showWord() {
  if (settingStore.allowWordTip) {
    //如果不是跟写模式，查看单词一律标记为错词
    if (settingStore.wordPracticeType !== WordPracticeType.FollowWrite || settingStore.dictation) {
      typo()
    }
    if (
      settingStore.wordPracticeType === WordPracticeType.Identify &&
      settingStore.identifyMethod === IdentifyMethod.WordTest
    ) {
      showAllCandidates = true
      return
    }
    showFullWord = true
  }
}

function hideWord() {
  showAllCandidates = false
  showFullWord = false
}

function editNote() {
  editingNote = !editingNote
  if (editingNote) {
    noteInputValue = store.noteData[props.word.word] ?? ''
  } else {
    noteInputValue = ''
  }
}

function saveNote() {
  if (noteInputValue.trim()) {
    store.noteData[props.word.word] = noteInputValue
  } else {
    delete store.noteData[props.word.word]
  }
  editingNote = false
}

function cancelNote() {
  editingNote = false
  noteInputValue = ''
}

function deleteNote() {
  delete store.noteData[props.word.word]
  editingNote = false
  noteInputValue = ''
}

function typo() {
  emit('wrong')
  wrongTimes.value++
}

function checkIsWrong() {
  if (settingStore.wordPracticeType === WordPracticeType.Dictation || settingStore.dictation) {
    if (!showWordResult.value && !right) {
      //输入完成，或者已显示的情况下，不记入错误
      typo()
    }
  }
}

function onVolumeIconClick() {
  checkIsWrong()
  playWord(WordPlayTrigger.Manual)
}

function play() {
  checkIsWrong()
  playWord(WordPlayTrigger.Shortcut)
}

function mouseleave() {
  setTimeout(() => {
    showFullWord = false
  }, 50)
}

watch([() => input, () => showFullWord, () => settingStore.dictation], checkCursorPosition)

//检测光标位置
function checkCursorPosition() {
  _nextTick(() => {
    let cursorOffset
    if (isTypingSentence()) {
      cursorOffset = { top: 0, left: 0 }
    } else {
      cursorOffset = { top: 0, left: -3 }
    }
    // 选中目标元素
    const cursorEl = document.querySelector(`.cursor`)
    const inputList = document.querySelectorAll(`.l`)
    if (!typingWordRef || !cursorEl) return
    const typingWordRect = typingWordRef.getBoundingClientRect()

    if (inputList.length) {
      let inputRect = last(Array.from(inputList)).getBoundingClientRect()
      cursor = {
        top: inputRect.top + inputRect.height - cursorEl.clientHeight - typingWordRect.top + cursorOffset.top,
        left: inputRect.right - typingWordRect.left + cursorOffset.left,
      }
    } else {
      const dictation = document.querySelector(`.dictation`)
      let elRect
      if (dictation) {
        elRect = dictation.getBoundingClientRect()
      } else {
        const letter = document.querySelector(`.letter`)
        elRect = letter.getBoundingClientRect()
      }
      cursor = {
        top: elRect.top + elRect.height - cursorEl.clientHeight - typingWordRect.top + cursorOffset.top,
        left: elRect.left - typingWordRect.left + cursorOffset.left,
      }
    }
  })
}

useEventsByWatch(
  [
    [ShortcutKey.KnowWord, know],
    [ShortcutKey.UnknownWord, unknown],
    [ShortcutKey.MasteredWord, mastered],
  ],
  () => isSelfAssessment
)

useEventsByWatch(
  [
    [ShortcutKey.ChooseA, e => select(e, 0)],
    [ShortcutKey.ChooseB, e => select(e, 1)],
    [ShortcutKey.ChooseC, e => select(e, 2)],
    [ShortcutKey.ChooseD, e => select(e, 3)],
  ],
  () => isWordTest
)

useEventsByWatch(
  SENTENCE_PLAY_SHORTCUT_KEYS.map((key, index) => [key, () => playSentence(index, { highlight: true })]),
  () => (props.word.sentences?.length ?? 0) > 0
)

const notice = $computed(() => {
  let text =
    settingStore.wordPracticeType === WordPracticeType.Identify
      ? '选择后/输入后，按空格键切换下一个'
      : settingStore.wordPracticeType === WordPracticeType.Listen
        ? '输入完成后按空格键切换下一个'
        : showWordResult.value
          ? right
            ? '按空格键切换下一个'
            : $t('press_delete_reinput')
          : '按空格键完成输入'
  return {
    show: [WordPracticeType.Listen, WordPracticeType.Identify, WordPracticeType.Dictation].includes(
      settingStore.wordPracticeType
    ),
    text,
  }
})

const { isWordSimple, toggleWordSimple } = useWordOptions()

const collectAnchorRef = ref<HTMLElement | null>(null)

function openCollectPicker(e: MouseEvent) {
  e.stopPropagation()
  openWordCollectPicker(props.word, e.currentTarget as HTMLElement, {
    excludeDictId: store.sdict.id ? String(store.sdict.id) : undefined,
  })
}

const isSimple = $computed(() => isWordSimple(props.word))

defineExpose({
  del,
  showWord,
  hideWord,
  play,
  showWordResult,
  wrongTimes,
  getCollectAnchor: () => collectAnchorRef.value,
})
</script>

<template>
  <!-- 模式1：图片认词卡 -->
<div v-if="settingStore.wordPracticeType === WordPracticeType.ImageCard" class="image-card-mode">
  <!-- 单词图片 -->
  <img 
    :src="word.image || 'https://picsum.photos/seed/'+word.word+'/400/300'" 
    class="word-image"
    style="width: 300px; height: 220px; border-radius: 12px; object-fit: cover; margin: 0 auto 20px;"
  >
  <!-- 单词+音标 -->
  <div class="word-text text-4xl font-bold mb-2">{{ word.word }}</div>
  <div class="phonetic text-gray-500 mb-4">/{{ word.phonetic }}/</div>
  <!-- 例句 -->
  <div class="sentence text-lg text-gray-700 mb-6" v-if="word.sentences?.[0]">
    {{ word.sentences[0].c }}
  </div>
  <!-- 下一个按钮 -->
  <BaseButton type="primary" @click="emit('complete')">认识了，下一个</BaseButton>
</div>
<template>
  <!-- 模式2：听音写词 -->
<div v-if="settingStore.wordPracticeType === WordPracticeType.ImageListen" class="image-listen-mode">
  <!-- 可点击发音的图片 -->
  <div 
    class="clickable-image cursor-pointer hover:opacity-80 transition"
    @click="playWord()"
    style="width: 300px; height: 220px; border-radius: 12px; background: #f5f5f5; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;"
  >
    <img 
      :src="word.image || 'https://picsum.photos/seed/'+word.word+'/400/300'" 
      style="width: 100%; height: 100%; border-radius: 12px; object-fit: cover;"
    >
    <div class="play-tip absolute text-white text-lg bg-black/50 px-4 py-2 rounded-full">点击发音 🔊</div>
  </div>
  <!-- 输入框 -->
  <input 
    v-model="input" 
    class="word-input w-80 text-2xl text-center border-b-2 border-gray-300 outline-none py-2 mb-4"
    placeholder="输入听到的单词"
    @keyup.enter="checkListenAnswer"
  >
  <!-- 确认按钮 -->
  <BaseButton type="primary" @click="checkListenAnswer">确认</BaseButton>
</div>
  // 模式2 校验听写答案
function checkListenAnswer() {
  if (input.trim().toLowerCase() === props.word.word.toLowerCase()) {
    playCorrect()
    emit('complete')
  } else {
    wrong = input
    wrongTimes.value++
    Toast.error('拼写错误，再试一次')
  }
}
  <template>
    <!-- 模式3：例句释义选择 -->
<div v-if="settingStore.wordPracticeType === WordPracticeType.SentenceChoice" class="sentence-choice-mode">
  <!-- 例句 -->
  <div class="sentence text-xl mb-8 text-center" v-if="word.sentences?.[0]">
    {{ word.sentences[0].c }}
  </div>
  <!-- 4个选项 -->
  <div class="options grid grid-cols-1 gap-3 w-96 mx-auto">
    <button 
      v-for="(opt, idx) in question.candidates" 
      :key="idx"
      class="option-btn py-3 px-4 border rounded-lg hover:border-blue-500 hover:bg-blue-50 transition text-left"
      @click="checkChoiceAnswer(idx)"
    >
      {{ String.fromCharCode(65+idx) }}. {{ opt.word.paraphrase || opt.word.trans[0]?.cn }}
    </button>
  </div>
</div>
    // 模式3 校验选择题答案
function checkChoiceAnswer(idx: number) {
  if (idx === question?.correctIndex) {
    playCorrect()
    emit('complete')
  } else {
    wrongTimes.value++
    Toast.error('选错了，再试试')
  }
}
<template>
  <!-- 模式4：例句翻译 -->
<div v-if="settingStore.wordPracticeType === WordPracticeType.SentenceTrans" class="sentence-trans-mode">
  <!-- 例句 -->
  <div class="sentence text-xl mb-6 text-center" v-if="word.sentences?.[0]">
    {{ word.sentences[0].c }}
  </div>
  <!-- 中文输入框 -->
  <textarea 
    v-model="input" 
    class="trans-input w-96 h-32 border rounded-lg p-3 text-lg outline-none focus:border-blue-500 mb-4 block mx-auto"
    placeholder="输入这句话的中文意思"
  ></textarea>
  <div class="flex gap-3 justify-center">
    <BaseButton @click="showAnswer = true">显示答案</BaseButton>
    <BaseButton type="primary" @click="emit('complete')">完成</BaseButton>
  </div>
  <!-- 答案显示 -->
  <div v-if="showAnswer" class="answer mt-4 text-green-600 text-center">
    正确翻译：{{ word.sentenceCn || word.trans[0]?.cn }}
  </div>
</div>
  let showAnswer = ref(false)
// 切换单词的时候重置答案显示
watch(() => props.word, () => {
  showAnswer.value = false
  // 原来的reset逻辑保留
})
<style scoped lang="scss">
.dictation {
  border-bottom: 2px solid gray;
}

.typing-word {
  width: 100%;
  flex: 1;
  //overflow: auto;
  word-break: break-word;
  position: relative;
  color: var(--color-font-2);

  .phonetic,
  .translate {
    font-size: 1.2rem;
  }

  .phonetic {
    color: var(--color-font-1);
    font-family: var(--word-font-family);
  }

  .word {
    font-size: 3rem;
    line-height: 1;
    font-family: var(--en-article-family);
    letter-spacing: 0.3rem;
  }

  .is-wrong {
    animation: shake 0.82s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }

  .input,
  .right {
    color: rgb(22, 163, 74);
  }

  .wrong {
    color: rgba(red, 0.6);
  }

  .tabs {
    @apply: text-lg font-medium;
    display: flex;
    gap: 2rem;

    .tab {
      cursor: pointer;

      &.active {
        border-bottom: 2px solid var(--color-font-2);
      }
    }
  }

  .label {
    width: 6rem;
    padding-top: 0.2rem;
    flex-shrink: 0;
  }

  .cn {
    @apply text-base;
  }

  .note-content {
    @apply text-base whitespace-pre-wrap;
  }

  .en {
    @apply text-lg;
  }

  .pos {
    @apply min-w-10;
  }

  .sentence {
    @apply rounded-lg px-3 py-2 -mx-3;
    background: transparent;
    transition: all .3s;
  }
  .sentence-highlight {
    background: rgba(124, 58, 237, 0.1);
    box-shadow: inset 0 0 0 1px rgba(124, 58, 237, 0.25);
  }
}

// 移动端适配
@media (max-width: 768px) {
  .typing-word {
    .label {
      @apply w-unset mr-2;
    }
    :deep(.pos) {
      @apply w-unset mr-2 min-w-unset;
    }
  }
}
</style>
