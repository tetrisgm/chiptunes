import mediaVideo from './media-stream.js'

export default function (options, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException('Capture cancelled', 'AbortError'))
  return navigator.mediaDevices.getDisplayMedia(options).then(stream => mediaVideo(stream, signal))
}
