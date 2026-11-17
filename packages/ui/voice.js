export function attachVoiceInput({ button, input, getLocale, onRecording = () => {}, onStatus = () => {}, onError = () => {} }) {
  let recording = false, recognition;
  button.onclick = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return onError('当前浏览器不支持语音识别，请使用文字输入。');
    if (recording) { recognition.stop(); return; }
    recognition = new Recognition(); recognition.lang = getLocale(); recognition.interimResults = true;
    recognition.onstart = () => { recording = true; button.classList.add('recording'); onRecording(true); onStatus('在听…再次结束后可编辑再发送'); };
    recognition.onresult = event => { input.value = [...event.results].map(result => result[0].transcript).join(''); };
    recognition.onerror = () => onError('语音未完成，请检查浏览器麦克风权限。');
    recognition.onend = () => { recording = false; button.classList.remove('recording'); onRecording(false); onStatus('可以改一改，再发送。'); };
    recognition.start();
  };
  return { stop: () => recognition?.stop() };
}
export function readAloud(text, locale) {
  if (!('speechSynthesis' in window)) throw new Error('这个浏览器暂不支持朗读');
  speechSynthesis.cancel(); const speech = new SpeechSynthesisUtterance(text); speech.lang = locale; speech.rate = .92; speechSynthesis.speak(speech);
}
