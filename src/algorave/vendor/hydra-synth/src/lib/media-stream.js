// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared capture lifecycle for the adapted upstream webcam/screen helpers.
export default function mediaVideo(stream, signal) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    let released = false, settled = false
    const release = (error = new DOMException('Capture cancelled', 'AbortError')) => {
      if (released) return
      released = true
      stream.getTracks().forEach(track => track.stop())
      video.pause()
      video.srcObject = null
      signal?.removeEventListener('abort', abort)
      video.removeEventListener('loadedmetadata', loaded)
      video.removeEventListener('error', failed)
      if (!settled) { settled = true; reject(error) }
    }
    const abort = () => release()
    const failed = () => release(new Error('Capture video could not load'))
    const loaded = async () => {
      try {
        await video.play()
        if (released || signal?.aborted) { release(); return }
        settled = true
        resolve({ video })
      } catch (error) { release(error) }
    }
    if (signal?.aborted) { release(); return }
    signal?.addEventListener('abort', abort, { once: true })
    video.addEventListener('loadedmetadata', loaded, { once: true })
    video.addEventListener('error', failed, { once: true })
    video.autoplay = true
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
  })
}
