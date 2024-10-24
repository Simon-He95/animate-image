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
}
let color = randomHexColor()

export async function animateImage(options: AnimateImageOptions, callback?: () => void): Promise<() => void> {
  const pointArr: any[] = []
  let flag = false
  const { width: w, height: h, infinity, container = 'body', images, duration = 1000, delay = 1000, isUpdateFromLastPosition, background = '#000' } = options
  const { clientWidth, clientHeight } = document.documentElement
  const width = w || clientWidth
  const height = h || clientHeight
  const { canvas, ctx } = new Canvas(width, height)
  canvas.style.background = background
  const historyStack: any[] = []
  const imageDatas = await Promise.all(images.map(getImageData))
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
      const prePointArr = Object.assign([], pointArr)
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
    }, 0)
  }

  function getPoint(imageData: any, prePointArr: any = []) {
    const { width, height, data } = imageData
    let i = 0
    let xV
    let yV
    for (let h = 0; h < height; h += 4) {
      for (let w = 0; w < width; w += 4) {
        const position = (width * h + w) * 4
        // const r = data[position]; const g = data[position + 1]; const b = data[position + 2];
        const a = data[position + 3]
        // 获取不透明的点
        if (a > 0) {
          const prePoint = prePointArr[i++]
          let x = prePoint?.x
          let y = prePoint?.y
          if (x)
            xV = x
          else if (xV)
            x = xV
          if (y)
            yV = y
          else if (yV)
            y = yV
          pointArr.push(new Point({
            canvas, ctx, size: 1, w, h, x, y,
          }))
        }
      }
    }
  }

  function awaitRun(s: number) {
    useRaf(run, s, true)
  }

  run()

  insertElement(container, canvas)
  return () => {
    stop?.()
    removeElement(canvas)
  }
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
  constructor(options: {
    canvas: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
    size: number
    w: number
    h: number
    x?: number
    y?: number
  }) {
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
  }

  // 圆点每次位置变化
  update() {
    this.spx = (this.w - this.x) / 2 / 20
    this.spy = (this.h - this.y) / 2 / 20
    if (Math.abs(this.w - this.x) <= Math.abs(this.offsetX))
      this.x = this.w
    else
      this.x += this.spx

    if (Math.abs(this.h - this.y) <= Math.abs(this.offsetY))
      this.y = this.h
    else
      this.y += this.spy

    // 粒子聚合成图像
    if (this.x === this.w && this.y === this.h)
      this.completed = true
  }

  // 渲染圆点
  render() {
    this.ctx.beginPath()
    this.ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
    this.ctx.fillStyle = this.completed ? color : '#fff'
    this.ctx.fill()
    this.ctx.closePath()
  }
}

