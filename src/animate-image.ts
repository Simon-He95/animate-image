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
    const { width, height, data } = imageData
    let i = 0
    let lastValidX, lastValidY

    // Adaptive pixel step based on screen size and performance
    const adaptiveStep = Math.max(
      4,
      Math.floor(pixelStep * (clientWidth > 1200 ? 1.5 : 1)),
    )

    for (let h = 0; h < height; h += adaptiveStep) {
      for (let w = 0; w < width; w += adaptiveStep) {
        const position = (width * h + w) * 4
        const r = data[position]
        const g = data[position + 1]
        const b = data[position + 2]
        const a = data[position + 3]
        // 获取不透明的点
        if (a > 0) {
          const prePoint = prePointArr[i++]
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
          const rgba = `rgba(${r}, ${g}, ${b}, ${a})`
          const initialFillStyle = prePoint?.initialFillStyle || rgba
          const fillStyle = rgba
          // Use the pool when creating points
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
    const { canvas, ctx, size, w, h, x, y } = options
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
    return this
  }

  reset(options: PointOption) {
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
    // Parse rgba values from color strings
    const parseColor = (color: string) => {
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)/)
      if (!match)
        return [255, 255, 255, 1] // Default white
      return [
        parseInt(match[1], 10),
        parseInt(match[2], 10),
        parseInt(match[3], 10),
        match[4] ? parseFloat(match[4]) : 1,
      ]
    }

    const [r1, g1, b1, a1] = parseColor(initialColor)
    const [r2, g2, b2, a2] = parseColor(targetColor)

    // Interpolate between the values
    const r = Math.round(r1 + (r2 - r1) * progress)
    const g = Math.round(g1 + (g2 - g1) * progress)
    const b = Math.round(b1 + (b2 - b1) * progress)
    const a = a1 + (a2 - a1) * progress

    return `rgba(${r}, ${g}, ${b}, ${a})`
  }

  // Modify render to use interpolated color
  render() {
    this.ctx.beginPath()
    this.ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)

    // Use interpolated color instead of binary switch
    const progress = this.getProgress()
    this.ctx.fillStyle = this.interpolateColor(
      this.initialFillStyle,
      this.fillStyle,
      progress,
    )

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

