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
  const { width: w, height: h, infinity, container = 'body', images, duration = 1000, delay = 1000, isUpdateFromLastPosition, background = '#000', pixelStep = 4 } = options
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
            canvas, ctx, size: 1, w, h, x, y, fillStyle, initialFillStyle,
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
    return this
  }

  // Replace the update method with time-based animation
  update(currentTime = performance.now()) {
    // Calculate progress (0 to 1)
    const elapsed = currentTime - this.startTime
    let progress = Math.min(1, elapsed / this.animationDuration)

    // Apply easing function for smooth acceleration/deceleration
    progress = this.easeInOutCubic(progress)

    // Update position using interpolation
    this.x = this.startX + (this.w - this.startX) * progress
    this.y = this.startY + (this.h - this.startY) * progress

    // Update completion state
    this.completed = progress >= 0.999
  }

  // Easing functions for smoother motion
  easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
  }

  // Calculate progress from 0 (start) to 1 (destination)
  getProgress(): number {
    // Calculate distance from starting position to current position
    const currentDistanceX = Math.abs(this.x - this.w)
    const currentDistanceY = Math.abs(this.y - this.h)

    // Calculate total distance from original position to target
    const originalDistanceX = Math.abs(this.offsetX) * 20 * 2
    const originalDistanceY = Math.abs(this.offsetY) * 20 * 2

    // Combine into a single progress value (0 to 1)
    const progressX = 1 - (currentDistanceX / originalDistanceX || 0)
    const progressY = 1 - (currentDistanceY / originalDistanceY || 0)

    // Use the average of both axes' progress
    return Math.min(1, Math.max(0, (progressX + progressY) / 2))
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
}

