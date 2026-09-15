import mediaVideo from './media-stream.js'
//const enumerateDevices = require('enumerate-devices')

export default function (deviceId, signal) {
  return navigator.mediaDevices.enumerateDevices()
    .then(devices => devices.filter(devices => devices.kind === 'videoinput'))
    .then(cameras => {
      if (signal?.aborted) throw new DOMException('Capture cancelled', 'AbortError')
      let constraints = { audio: false, video: true}
      if (cameras[deviceId]) {
        constraints['video'] = {
          deviceId: { exact: cameras[deviceId].deviceId }
        }
      }
    //  console.log(cameras)
      return window.navigator.mediaDevices.getUserMedia(constraints)
    })
    .then(stream => mediaVideo(stream, signal))
}
