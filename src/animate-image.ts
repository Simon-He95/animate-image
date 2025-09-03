import { Canvas, getImageData, insertElement, randomHexColor, removeElement, useRaf } from 'lazy-js-utils'

interface AnimateImageOptions {
  images: string[]
  width?: number
  height?: number
  infinity?: boolean
  container?: string
  duration?: number
  delay?: number
  isUpdateFromLastPosition?: boolean
  background?: string
  pixelStep?: number // Add this property
  easing?: string // Add easing property
}

interface ImageData {
  width: number
  height: number
  data: Uint8ClampedArray
}
let color = randomHexColor()

// Create a pool of reusable Point objects
const pointPool: Point[] = []

function getPointFromPool(options: PointOption): Point {
  if (pointPool.length > 0) {
    const point = pointPool.pop()!
    point.reset(options)
    return point
  }
  return new Point(options)
}

export async function animateImage(options: AnimateImageOptions, callback?: () => void): Promise<() => void> {
  const pointArr: Point[] = []
  let flag = false
  const {
    width: w,
    height: h,
    infinity,
    container = 'body',
    images,
    duration = 1000,
    delay = 1000,
    isUpdateFromLastPosition,
    background = '#000',
    pixelStep = 4,
    easing = 'easeInOutCubic', // Default easing
  } = options
  const { clientWidth, clientHeight } = document.documentElement
  const width = w || clientWidth
  const height = h || clientHeight
  const { canvas, ctx } = new Canvas(width, height)
  canvas.style.background = background
  const historyStack: ImageData[] = []
  const imageDatas = await Promise.all(
    images.map(url =>
      getImageData(url).catch((err: any) => {
        console.error(`Failed to load image: ${url}`, err)
        return null
      }),
    ),
  ).then(results => results.filter(Boolean) as ImageData[])
  let stop: () => void

  const run = () => {
    if (infinity && !imageDatas.length) {
      imageDatas.push(historyStack.shift()!)
    }
    else if (!imageDatas.length) {
      stop()
      return callback?.()
    }
    flag = false
    if (isUpdateFromLastPosition) {
      const prePointArr = [...pointArr]
      pointArr.length = 0
      const imageData = imageDatas.pop()!
      historyStack.push(imageData)
      getPoint(imageData, prePointArr)
      prePointArr.length = 0
    }
    else {
      pointArr.length = 0
      const imageData = imageDatas.pop()!
      historyStack.push(imageData)
      getPoint(imageData)
    }
    stop = useRaf(() => {
      if (flag) {
        stop()
        color = randomHexColor()
        return setTimeout(() => awaitRun(duration), delay)
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      pointArr.forEach((point) => {
        if (point.completed)
          flag = true
        else
          flag = false

        point.update()
        point.render()
      })
    })
  }

  function getPoint(imageData: ImageData, prePointArr: Point[] = []) {
    const { width: imgW, height: imgH, data } = imageData
    // helper: extract and return the closest previous point (by combined pos+color distance) from prePointArr
    function extractClosestPrePoint(arr: Point[], txCanvas: number, tyCanvas: number, targetColor: Uint8ClampedArray): Point | undefined {
      if (!arr || arr.length === 0)
        return undefined
      let bestIdx = -1
      let bestScore = Infinity
      const maxDim = Math.max(canvas.width, canvas.height)
      const maxPosSq = maxDim * maxDim
      const colorWeight = 0.7 // tunable: how much color distance matters relative to position
      for (let k = 0; k < arr.length; k++) {
        const p = arr[k]
        // use current displayed position if available, otherwise fallback to target
        const px = (typeof p.x === 'number') ? p.x : p.w
        const py = (typeof p.y === 'number') ? p.y : p.h
        const dx = px - txCanvas
        const dy = py - tyCanvas
        const posDistSq = dx * dx + dy * dy

        // compute current displayed color for p using its parsed caches if possible
        let pr = 255; let pg = 255; let pb = 255
        const pProgress = (typeof p.getProgress === 'function') ? p.getProgress() : 1
        if (p.__parsedInitialColor || p.__parsedTargetColor) {
          const pi = p.__parsedInitialColor || p.__parseColorToTyped(p.initialFillStyle)
          const pt = p.__parsedTargetColor || p.__parseColorToTyped(p.fillStyle)
          pr = Math.round(pi[0] + (pt[0] - pi[0]) * pProgress)
          pg = Math.round(pi[1] + (pt[1] - pi[1]) * pProgress)
          pb = Math.round(pi[2] + (pt[2] - pi[2]) * pProgress)
        }

        const dr = pr - targetColor[0]
        const dg = pg - targetColor[1]
        const db = pb - targetColor[2]
        const colorDistSq = dr * dr + dg * dg + db * db

        // normalize distances and combine
        const posNorm = posDistSq / (maxPosSq || 1)
        const colorNorm = colorDistSq / (255 * 255 * 3)
        const score = posNorm + colorWeight * colorNorm

        if (score < bestScore) {
          bestScore = score
          bestIdx = k
        }
      }
      if (bestIdx === -1)
        return undefined
      return arr.splice(bestIdx, 1)[0]
    }
    let lastValidX, lastValidY

    // Adaptive pixel step based on screen size and performance
    const adaptiveStep = Math.max(
      4,
      Math.floor(pixelStep * (clientWidth > 1200 ? 1.5 : 1)),
    )

    for (let h = 0; h < imgH; h += adaptiveStep) {
      for (let w = 0; w < imgW; w += adaptiveStep) {
        const position = (imgW * h + w) * 4
        const r = data[position]
        const g = data[position + 1]
        const b = data[position + 2]
        const a = data[position + 3]
        // 获取不透明的点
        if (a > 0) {
          // map target pixel coords to canvas coords
          const txCanvas = Math.round((w / imgW) * canvas.width)
          const tyCanvas = Math.round((h / imgH) * canvas.height)
          const targetColor = new Uint8ClampedArray([r, g, b, a])
          // find the closest previous point by combined position+color distance to keep visual continuity
          const prePoint = extractClosestPrePoint(prePointArr, txCanvas, tyCanvas, targetColor)
          let x = prePoint?.x
          let y = prePoint?.y
          if (x)
            lastValidX = x
          else if (lastValidX)
            x = lastValidX
          if (y)
            lastValidY = y
          else if (lastValidY)
            y = lastValidY
          // Convert alpha from 0-255 to 0-1 for CSS rgba
          const alpha = +(a / 255).toFixed(3)
          const rgba = `rgba(${r}, ${g}, ${b}, ${alpha})`
          // Determine starting color for this point.
          // Prefer sampling the canvas at the previous point's current displayed position
          // so we capture the actual pixel color the user sees. Fall back to the
          // prePoint's computed interpolation if sampling isn't possible.
          let initialFillStyle: string
          if (prePoint) {
            try {
              const sx = Math.round(prePoint.x)
              const sy = Math.round(prePoint.y)
              // clamp to canvas bounds
              const cx = Math.max(0, Math.min(canvas.width - 1, sx))
              const cy = Math.max(0, Math.min(canvas.height - 1, sy))
              const img = ctx.getImageData(cx, cy, 1, 1).data
              const ir = img[0]; const ig = img[1]; const ib = img[2]; const ia = img[3]
              initialFillStyle = `rgba(${ir}, ${ig}, ${ib}, ${+(ia / 255).toFixed(3)})`
            }
            catch (e) {
              // If getImageData is not allowed or fails, fall back to computing from prePoint
              initialFillStyle = prePoint.interpolateColor(prePoint.initialFillStyle, prePoint.fillStyle, prePoint.getProgress())
            }
          }
          else {
            initialFillStyle = color
          }

          const fillStyle = rgba
          // Use the pool when creating points and ensure animation duration is passed through
          pointArr.push(getPointFromPool({
            canvas,
            ctx,
            size: 1,
            w,
            h,
            x,
            y,
            fillStyle,
            initialFillStyle,
            easing, // Pass the easing option
            animationDuration: duration,
          }))
        }
      }
    }
  }

  function awaitRun(s: number) {
    useRaf(run, {
      delta: s,
      autoStop: true,
    })
  }

  run()

  insertElement(container, canvas)
  return () => {
    stop?.()
    // Return points to pool instead of discarding them
    pointArr.forEach(point => pointPool.push(point))
    pointArr.length = 0
    historyStack.length = 0
    removeElement(canvas)
  }
}

interface PointOption {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  size: number
  w: number
  h: number
  x?: number
  y?: number
  fillStyle?: string
  initialFillStyle?: string
  easing?: string
  animationDuration?: number
}
class Point {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  offsetX: number
  offsetY: number
  x: number
  y: number
  w: number
  h: number
  size: number
  spx: number
  spy: number
  completed = false
  fillStyle = '#fff'
  initialFillStyle = '#fff'
  startX: number
  startY: number
  startTime = 0
  animationDuration = 1000 // ms
  easing = 'easeInOutCubic'

  constructor(options: PointOption) {
    const { canvas, ctx, size, w, h, x, y, animationDuration } = options
    this.canvas = canvas
    this.ctx = ctx
    this.x = x ?? Math.random() * canvas.width
    this.y = y ?? Math.random() * canvas.height
    this.size = size
    this.w = w
    this.h = h
    this.offsetX = this.spx = (w - this.x) / 2 / 20
    this.offsetY = this.spy = (h - this.y) / 2 / 20
    this.fillStyle = options.fillStyle || color
    this.initialFillStyle = options.initialFillStyle || color
    this.completed = false
    this.startX = this.x
    this.startY = this.y
    this.startTime = performance.now()
    this.easing = options.easing || 'easeInOutCubic'
    if (typeof animationDuration === 'number' && animationDuration > 0)
      this.animationDuration = animationDuration
    // cached parsed color keys and values
    this.__parsedInitialKey = undefined
    this.__parsedTargetKey = undefined
    this.__parsedInitialColor = undefined
    this.__parsedTargetColor = undefined
    return this
  }

  reset(options: PointOption) {
    const { animationDuration } = options
    this.x = options.x ?? Math.random() * this.canvas.width
    this.y = options.y ?? Math.random() * this.canvas.height
    this.w = options.w
    this.h = options.h
    this.offsetX = this.spx = (this.w - this.x) / 2 / 20
    this.offsetY = this.spy = (this.h - this.y) / 2 / 20
    this.fillStyle = options.fillStyle || color
    this.initialFillStyle = options.initialFillStyle || color
    this.completed = false
    this.startX = this.x
    this.startY = this.y
    this.startTime = performance.now()
    this.easing = options.easing || 'easeInOutCubic'
    if (typeof animationDuration === 'number' && animationDuration > 0)
      this.animationDuration = animationDuration
    // reset cached parsed colors
    this.__parsedInitialKey = undefined
    this.__parsedTargetKey = undefined
    this.__parsedInitialColor = undefined
    this.__parsedTargetColor = undefined
    return this
  }

  // Apply the selected easing function
  applyEasing(t: number): number {
    switch (this.easing) {
      case 'linear': return this.linear(t)
      case 'easeInQuad': return this.easeInQuad(t)
      case 'easeOutQuad': return this.easeOutQuad(t)
      case 'easeInOutQuad': return this.easeInOutQuad(t)
      case 'easeInCubic': return this.easeInCubic(t)
      case 'easeOutCubic': return this.easeOutCubic(t)
      case 'easeInOutCubic': return this.easeInOutCubic(t)
      case 'easeInElastic': return this.easeInElastic(t)
      case 'easeOutElastic': return this.easeOutElastic(t)
      case 'easeInOutElastic': return this.easeInOutElastic(t)
      case 'easeInBounce': return this.easeInBounce(t)
      case 'easeOutBounce': return this.easeOutBounce(t)
      case 'easeInOutBounce': return this.easeInOutBounce(t)
      default: return this.easeInOutCubic(t)
    }
  }

  // Update method to use the selected easing
  update(currentTime = performance.now()) {
    const elapsed = currentTime - this.startTime
    let progress = Math.min(1, elapsed / this.animationDuration)

    // Apply selected easing function
    progress = this.applyEasing(progress)

    this.x = this.startX + (this.w - this.startX) * progress
    this.y = this.startY + (this.h - this.startY) * progress

    this.completed = progress >= 0.999
  }

  // Easing library implementation
  linear(t: number): number {
    return t
  }

  easeInQuad(t: number): number {
    return t * t
  }

  easeOutQuad(t: number): number {
    return t * (2 - t)
  }

  easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
  }

  easeInCubic(t: number): number {
    return t * t * t
  }

  easeOutCubic(t: number): number {
    return (--t) * t * t + 1
  }

  easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
  }

  easeInElastic(t: number): number {
    return t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3))
  }

  easeOutElastic(t: number): number {
    return t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
  }

  easeInOutElastic(t: number): number {
    return t === 0
      ? 0
      : t === 1
        ? 1
        : t < 0.5
          ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * ((2 * Math.PI) / 4.5))) / 2
          : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * ((2 * Math.PI) / 4.5))) / 2 + 1
  }

  easeInBounce(t: number): number {
    return 1 - this.easeOutBounce(1 - t)
  }

  easeOutBounce(t: number): number {
    if (t < 1 / 2.75)
      return 7.5625 * t * t
    else if (t < 2 / 2.75)
      return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75
    else if (t < 2.5 / 2.75)
      return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375
    else
      return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375
  }

  easeInOutBounce(t: number): number {
    return t < 0.5
      ? (1 - this.easeOutBounce(1 - 2 * t)) / 2
      : (1 + this.easeOutBounce(2 * t - 1)) / 2
  }

  // Helper to interpolate between colors
  interpolateColor(initialColor: string, targetColor: string, progress: number): string {
    // Small cache: avoid reparsing same color strings repeatedly
    if (this.__parsedInitialKey !== initialColor) {
      this.__parsedInitialKey = initialColor
      this.__parsedInitialColor = this.__parseColorToTyped(initialColor)
    }
    if (this.__parsedTargetKey !== targetColor) {
      this.__parsedTargetKey = targetColor
      this.__parsedTargetColor = this.__parseColorToTyped(targetColor)
    }

    const pi = this.__parsedInitialColor || new Uint8ClampedArray([255, 255, 255, 255])
    const pt = this.__parsedTargetColor || new Uint8ClampedArray([255, 255, 255, 255])
    const r1 = pi[0]; const g1 = pi[1]; const b1 = pi[2]; const a1 = pi[3]
    const r2 = pt[0]; const g2 = pt[1]; const b2 = pt[2]; const a2 = pt[3]

    // integer interpolation for rgb and alpha (alpha still 0-255)
    const r = Math.round(r1 + (r2 - r1) * progress)
    const g = Math.round(g1 + (g2 - g1) * progress)
    const b = Math.round(b1 + (b2 - b1) * progress)
    const aInt = Math.round(a1 + (a2 - a1) * progress)
    const a = +(aInt / 255).toFixed(3)

    return `rgba(${r}, ${g}, ${b}, ${a})`
  }

  // internal cached parsed colors as typed arrays (r,g,b,a) where r/g/b in 0-255, a in 0-1
  __parsedInitialKey?: string
  __parsedTargetKey?: string
  // store as Uint8ClampedArray [r,g,b,a] with a in 0-255 for compactness and integer ops
  __parsedInitialColor?: Uint8ClampedArray
  __parsedTargetColor?: Uint8ClampedArray
  // cache the last produced rgba string and the progress it was based on
  __cachedColorString?: string
  __cachedColorProgress?: number

  // parse helper that returns a Float32Array [r, g, b, a]
  __parseColorToTyped(color: string): Uint8ClampedArray {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)/)
    if (!match)
      return new Uint8ClampedArray([255, 255, 255, 255])
    const r = parseInt(match[1], 10)
    const g = parseInt(match[2], 10)
    const b = parseInt(match[3], 10)
    const aFloat = match[4] ? parseFloat(match[4]) : 1
    const a = Math.round(aFloat * 255)
    return new Uint8ClampedArray([r, g, b, a])
  }

  // Modify render to use interpolated color
  render() {
    this.ctx.beginPath()
    this.ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)

    // Use interpolated color instead of binary switch
    const progress = this.getProgress()
    // If fully completed, set exact final color to avoid rounding mismatch
    if (progress >= 0.999) {
      this.ctx.fillStyle = this.fillStyle
      this.ctx.fill()
      this.ctx.closePath()
      return
    }
    // Reuse cached string if progress didn't change much
    const reuseThreshold = 0.01
    if (this.__cachedColorString && typeof this.__cachedColorProgress === 'number' && Math.abs(this.__cachedColorProgress - progress) < reuseThreshold) {
      this.ctx.fillStyle = this.__cachedColorString
    }
    else {
      // Compute numeric interpolation using cached typed arrays (faster than reparsing strings)
      if (this.__parsedInitialKey !== this.initialFillStyle) {
        this.__parsedInitialKey = this.initialFillStyle
        this.__parsedInitialColor = this.__parseColorToTyped(this.initialFillStyle)
      }
      if (this.__parsedTargetKey !== this.fillStyle) {
        this.__parsedTargetKey = this.fillStyle
        this.__parsedTargetColor = this.__parseColorToTyped(this.fillStyle)
      }
      const pi = this.__parsedInitialColor || new Uint8ClampedArray([255, 255, 255, 255])
      const pt = this.__parsedTargetColor || new Uint8ClampedArray([255, 255, 255, 255])
      const r = Math.round(pi[0] + (pt[0] - pi[0]) * progress)
      const g = Math.round(pi[1] + (pt[1] - pi[1]) * progress)
      const b = Math.round(pi[2] + (pt[2] - pi[2]) * progress)
      const aInt = Math.round(pi[3] + (pt[3] - pi[3]) * progress)
      const a = +(aInt / 255).toFixed(3)
      const rgbaStr = `rgba(${r}, ${g}, ${b}, ${a})`
      this.__cachedColorString = rgbaStr
      this.__cachedColorProgress = progress
      this.ctx.fillStyle = rgbaStr
    }

    this.ctx.fill()
    this.ctx.closePath()
  }

  getProgress(): number {
    // For best results, use the same progress calculation as the motion
    const elapsed = performance.now() - this.startTime
    const progress = Math.min(1, elapsed / this.animationDuration)
    return this.applyEasing(progress)
  }
}

