import Webcam from './lib/webcam.js'
import Screen from './lib/screenmedia.js'

class HydraSource {
  constructor ({ regl, width, height, pb, label = ""}) {
    this.label = label
    this.regl = regl
    this.src = null
    this.dynamic = true
    this.width = width
    this.height = height
    this.replaceTexture({
      //  shape: [width, height]
      shape: [ 1, 1 ]
    })
    this.pb = pb
  }

  replaceTexture (options) {
    const next = this.regl.texture(options)
    this.tex?.destroy()
    this.tex = next
  }

  init (opts, params) {
    if ('src' in opts) {
      this.stopCapture()
      this.src = opts.src
      this.replaceTexture({ data: this.src, ...params })
    }
    if ('dynamic' in opts) this.dynamic = opts.dynamic
  }

  initCam (index, params) {
    const self = this
    this.stopCapture()
    const controller = this.captureController = new AbortController()
    Webcam(index, controller.signal)
      .then(response => {
        if (controller.signal.aborted) return
        self.src = response.video
        self.dynamic = true
        self.replaceTexture({ data: self.src, ...params })
      })
      .catch(err => { if (err.name !== 'AbortError') console.log('could not get camera', err) })
  }

  initVideo (url = '', params) {
    this.stopCapture()
    const version = this.sourceVersion
    // const self = this
    const vid = document.createElement('video')
    vid.crossOrigin = 'anonymous'
    vid.autoplay = true
    vid.loop = true
    vid.muted = true // mute in order to load without user interaction
    this.pendingCleanup = () => { vid.removeEventListener('loadeddata', loaded); vid.pause(); vid.removeAttribute('src'); vid.load() }
    const loaded = () => {
      if (version !== this.sourceVersion) return
      this.replaceTexture({ data: vid, ...params})
      this.pendingCleanup = undefined
      this.ownedVideo = vid
      this.src = vid
      void vid.play().catch(err => console.log('could not play video', err))
      this.dynamic = true
    }
    vid.addEventListener('loadeddata', loaded, { once: true })
    vid.src = url
  }

  initImage (url = '', params) {
    this.stopCapture()
    const version = this.sourceVersion
    const img = document.createElement('img')
    img.crossOrigin = 'anonymous'
    this.pendingCleanup = () => { img.onload = null; img.removeAttribute('src') }
    img.onload = () => {
      if (version !== this.sourceVersion) return
      this.replaceTexture({ data: img, ...params})
      this.pendingCleanup = undefined
      img.onload = null
      this.src = img
      this.dynamic = false
    }
    img.src = url
  }

  initStream (streamName, params) {
    this.stopCapture()
    //  console.log("initing stream!", streamName)
    let self = this
    if (streamName && this.pb) {
      this.pb.initSource(streamName)

      this.pb.on('got video', function (nick, video) {
        if (nick === streamName) {
          self.src = video
          self.dynamic = true
          self.replaceTexture({ data: self.src, ...params})
        }
      })
    }
  }

  // index only relevant in atom-hydra + desktop apps
  initScreen (index = 0, params) {
    const self = this
    this.stopCapture()
    const controller = this.captureController = new AbortController()
    Screen(undefined, controller.signal)
      .then(function (response) {
        if (controller.signal.aborted) return
        self.src = response.video
        self.replaceTexture({ data: self.src, ...params})
        self.dynamic = true
        //  console.log("received screen input")
      })
      .catch(err => { if (err.name !== 'AbortError') console.log('could not get screen', err) })
  }

  // cache for the canvases, so we don't create them every time
  canvases = {}

  // Creates a canvas and returns the 2d context
  initCanvas (width = 1000, height = 1000) {
    if (this.canvases[this.label] == undefined) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext('2d')
      if(ctx != null)
        this.canvases[this.label] = ctx
    }

    const ctx = this.canvases[this.label]
    const canvas = ctx.canvas
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    } else {
      ctx.clearRect(0, 0, width, height)
    }
    this.init({ src: canvas })

    this.dynamic = true
    return ctx
  }

  resize (width, height) {
    this.width = width
    this.height = height
  }

  stopCapture () {
    this.sourceVersion = (this.sourceVersion || 0) + 1
    this.pendingCleanup?.()
    this.pendingCleanup = undefined
    if (this.ownedVideo) {
      this.ownedVideo.pause()
      this.ownedVideo.removeAttribute('src')
      this.ownedVideo.load()
      if (this.src === this.ownedVideo) this.src = null
      this.ownedVideo = undefined
    }
    if (!this.captureController) return
    const video = this.src
    this.captureController.abort()
    this.captureController = undefined
    if (video instanceof HTMLVideoElement && !video.srcObject) this.src = null
  }

  clear () {
    this.stopCapture()
    if (this.src && this.src.srcObject) {
      if (this.src.srcObject.getTracks) {
        this.src.srcObject.getTracks().forEach(track => track.stop())
      }
    }
    this.src = null
    this.replaceTexture({ shape: [ 1, 1 ] })
  }

  tick (time) {
    //  console.log(this.src, this.tex.width, this.tex.height)
    if (this.src && this.dynamic === true) {
      if (this.src.videoWidth && (this.src.videoWidth !== this.tex.width || this.src.videoHeight !== this.tex.height)) {
        console.log(
          this.src.videoWidth,
          this.src.videoHeight,
          this.tex.width,
          this.tex.height
        )
        this.tex.resize(this.src.videoWidth, this.src.videoHeight)
      }

      if (this.src.width && (this.src.width !== this.tex.width || this.src.height !== this.tex.height)) {
        this.tex.resize(this.src.width, this.src.height)
      }

      this.tex.subimage(this.src)
    }
  }

  getTexture () {
    return this.tex
  }
}

export default HydraSource
