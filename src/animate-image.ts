import { Canvas, getImageData, insertElement, randomHexColor, removeElement, useRaf } from 'lazy-js-utils'
import type { Align, AnimateImageCleanup, AnimateImageOptions, ColorSampling, Easing, ImageFit, InteractionMode, PointShape } from './types'

interface LoadedImageData {
  width: number
  height: number
  data: Uint8ClampedArray
}
let color = randomHexColor()

interface BurstCenter {
  x: number
  y: number
}

interface BurstFrame extends BurstCenter {
  radius: number
  strength: number
}

interface NormalizedBurst {
  enabled: boolean
  radius: number
  strength: number
}

interface InteractionFrame {
  active: boolean
  x: number
  y: number
  mode: InteractionMode
  radius: number
  strength: number
  damping: number
  spring: number
  burst?: BurstFrame
}

interface NormalizedInteraction {
  enabled: boolean
  mode: InteractionMode
  radius: number
  strength: number
  damping: number
  spring: number
  burst: NormalizedBurst
}

// Create a pool of reusable Point objects
const pointPool: Point[] = []
const DEFAULT_MAX_POOL_SIZE = 200_000

function getPointFromPool(options: PointOption): Point {
  if (pointPool.length > 0) {
    const point = pointPool.pop()!
    point.reset(options)
    return point
  }
  return new Point(options)
}

function resolveAlign(align: Align | undefined, remaining: number) {
  switch (align) {
    case 'end': return remaining
    case 'center': return remaining / 2
    case 'start':
    default: return 0
  }
}

function computeImageTransform(
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
  fit: ImageFit,
  alignX: Align | undefined,
  alignY: Align | undefined,
) {
  let scaleX = 1
  let scaleY = 1
  if (fit === 'stretch') {
    scaleX = canvasW / imgW
    scaleY = canvasH / imgH
  }
  else if (fit === 'contain' || fit === 'cover') {
    const s = fit === 'contain'
      ? Math.min(canvasW / imgW, canvasH / imgH)
      : Math.max(canvasW / imgW, canvasH / imgH)
    scaleX = s
    scaleY = s
  }
  // 'none' => 1,1

  const drawW = imgW * scaleX
  const drawH = imgH * scaleY
  const offsetX = resolveAlign(alignX, canvasW - drawW)
  const offsetY = resolveAlign(alignY, canvasH - drawH)
  return { scaleX, scaleY, offsetX, offsetY }
}

function clamp01(n: number) {
  if (Number.isNaN(n))
    return 1
  return Math.max(0, Math.min(1, n))
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function normalizeInteraction(interaction: AnimateImageOptions['interaction']): NormalizedInteraction {
  // Internal normalized shape (keeps runtime branch-free in the hot loop).
  const defaults = {
    enabled: true,
    mode: 'repel' as const,
    radius: 120,
    strength: 900,
    damping: 0.88,
    spring: 36,
    burst: { enabled: true, radius: 220, strength: 1100 },
  }

  if (!interaction)
    return { ...defaults, enabled: false, burst: defaults.burst }
  if (interaction === true)
    return defaults

  let burst = defaults.burst
  if (interaction.burst === false) {
    burst = { enabled: false, radius: defaults.burst.radius, strength: defaults.burst.strength }
  }
  else if (interaction.burst === true || typeof interaction.burst === 'undefined') {
    burst = defaults.burst
  }
  else {
    burst = {
      enabled: true,
      radius: interaction.burst.radius ?? defaults.burst.radius,
      strength: interaction.burst.strength ?? defaults.burst.strength,
    }
  }

  return {
    enabled: interaction.enabled ?? defaults.enabled,
    mode: interaction.mode ?? defaults.mode,
    radius: interaction.radius ?? defaults.radius,
    strength: interaction.strength ?? defaults.strength,
    damping: interaction.damping ?? defaults.damping,
    spring: interaction.spring ?? defaults.spring,
    burst,
  }
}

export async function animateImage(options: AnimateImageOptions, callback?: () => void): Promise<AnimateImageCleanup> {
  const pointArr: Point[] = []
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
    alphaThreshold = 0,
    maxParticles,
    pointSize = 1,
    pointShape = 'circle',
    jitter = 0,
    easing = 'easeInOutCubic',
    fit = 'contain',
    alignX = 'center',
    alignY = 'center',
    compositeOperation = 'source-over',
    fade = 1,
    sampleFromCanvas = true,
    interaction,
    colorSampling: colorSamplingOption = 'scaled',
  } = options
  const { clientWidth, clientHeight } = document.documentElement
  const width = w || clientWidth
  const height = h || clientHeight
  const dpr = window.devicePixelRatio || 1
  const { canvas, ctx } = new Canvas(width, height)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  canvas.style.display = 'block'
  canvas.style.background = background
  // Draw in CSS pixel coordinates for predictable sizing.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const historyStack: LoadedImageData[] = []
  const imageDatas = await Promise.all(
    images.map(url =>
      getImageData(url).catch((err: any) => {
        console.error(`Failed to load image: ${url}`, err)
        return null
      }),
    ),
  ).then(results => results.filter(Boolean) as LoadedImageData[])

  let rafStop: (() => void) | undefined
  let nextRunStop: (() => void) | undefined
  let destroyed = false
  const interactionOpt = normalizeInteraction(interaction)
  const interactionState = {
    active: false,
    x: width / 2,
    y: height / 2,
    burst: undefined as undefined | BurstCenter,
  }
  let removeInteractionListeners: (() => void) | undefined
  const colorSampling: ColorSampling = colorSamplingOption

  const sourceCanvasCache = new WeakMap<LoadedImageData, HTMLCanvasElement>()
  const scaledDataCache = new WeakMap<LoadedImageData, Map<string, LoadedImageData>>()

  function getSourceCanvas(imageData: LoadedImageData) {
    const cached = sourceCanvasCache.get(imageData)
    if (cached)
      return cached
    const c = document.createElement('canvas')
    c.width = imageData.width
    c.height = imageData.height
    const cctx = c.getContext('2d')
    if (!cctx)
      return c
    const img = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
    cctx.putImageData(img, 0, 0)
    sourceCanvasCache.set(imageData, c)
    return c
  }

  function getScaledImageData(imageData: LoadedImageData, drawW: number, drawH: number) {
    const key = `${drawW}x${drawH}`
    let perImage = scaledDataCache.get(imageData)
    if (!perImage) {
      perImage = new Map()
      scaledDataCache.set(imageData, perImage)
    }
    const cached = perImage.get(key)
    if (cached)
      return cached

    const src = getSourceCanvas(imageData)
    const c = document.createElement('canvas')
    c.width = drawW
    c.height = drawH
    const cctx = c.getContext('2d')
    if (!cctx) {
      const fallback = { width: drawW, height: drawH, data: new Uint8ClampedArray(drawW * drawH * 4) }
      perImage.set(key, fallback)
      return fallback
    }
    cctx.imageSmoothingEnabled = true
    cctx.clearRect(0, 0, drawW, drawH)
    cctx.drawImage(src, 0, 0, drawW, drawH)
    const scaled = cctx.getImageData(0, 0, drawW, drawH)
    const result = { width: drawW, height: drawH, data: scaled.data }
    perImage.set(key, result)
    return result
  }

  function recyclePoints(points: Point[]) {
    for (const p of points) {
      if (pointPool.length < DEFAULT_MAX_POOL_SIZE)
        pointPool.push(p)
    }
    points.length = 0
  }

  const run = () => {
    if (destroyed)
      return

    if (infinity && !imageDatas.length) {
      const next = historyStack.shift()
      if (next)
        imageDatas.push(next)
    }
    else if (!imageDatas.length) {
      rafStop?.()
      return callback?.()
    }
    const imageData = imageDatas.pop()!
    historyStack.push(imageData)

    let prePointArr: Point[] = []
    if (isUpdateFromLastPosition) {
      // Keep the previous points around for matching and (when possible) reuse them directly.
      prePointArr = pointArr.splice(0, pointArr.length)
    }
    else {
      recyclePoints(pointArr)
      getPoint(imageData)
      prePointArr = []
    }

    if (isUpdateFromLastPosition) {
      getPoint(imageData, prePointArr)
      // Any points not reused are returned to the pool.
      recyclePoints(prePointArr)
    }

    rafStop?.()
    rafStop = useRaf(() => {
      const interactionFrame: InteractionFrame | undefined = interactionOpt.enabled
        ? {
            active: interactionState.active && interactionOpt.mode !== 'none',
            x: interactionState.x,
            y: interactionState.y,
            mode: interactionOpt.mode,
            radius: interactionOpt.radius,
            strength: interactionOpt.strength,
            damping: clamp01(interactionOpt.damping),
            spring: Math.max(0, interactionOpt.spring),
            burst: interactionState.burst && interactionOpt.burst.enabled
              ? { x: interactionState.burst.x, y: interactionState.burst.y, radius: interactionOpt.burst.radius, strength: interactionOpt.burst.strength }
              : undefined,
          }
        : undefined

      // Clear / fade.
      const fadeKeep = clamp01(fade)
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      if (fadeKeep >= 0.999) {
        ctx.clearRect(0, 0, width, height)
      }
      else {
        ctx.globalAlpha = 1 - fadeKeep
        ctx.fillStyle = background
        ctx.fillRect(0, 0, width, height)
      }
      ctx.restore()

      ctx.globalCompositeOperation = compositeOperation

      const now = performance.now()
      let allCompleted = true
      for (const point of pointArr) {
        point.update(now, interactionFrame)
        if (!point.completed)
          allCompleted = false
        point.render(point.progress)
      }
      if (interactionState.burst)
        interactionState.burst = undefined

      if (allCompleted) {
        rafStop?.()
        color = randomHexColor()

        // Keep behavior: wait (delay + duration) between images.
        nextRunStop?.()
        nextRunStop = useRaf(run, {
          delta: delay + duration,
          autoStop: true,
        })
      }
    })
  }

  function buildPointGrid(points: Point[], cellSize: number) {
    const grid = new Map<string, Point[]>()
    const key = (x: number, y: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`

    for (const p of points) {
      const k = key(p.x, p.y)
      const bucket = grid.get(k)
      if (bucket)
        bucket.push(p)
      else
        grid.set(k, [p])
    }

    function takeClosest(x: number, y: number) {
      const gx = Math.floor(x / cellSize)
      const gy = Math.floor(y / cellSize)

      let bestDist = Infinity
      let bestPoint: Point | undefined
      let bestBucket: Point[] | undefined
      let bestIndex = -1

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(`${gx + dx},${gy + dy}`)
          if (!bucket || bucket.length === 0)
            continue
          for (let i = 0; i < bucket.length; i++) {
            const p = bucket[i]
            const ddx = p.x - x
            const ddy = p.y - y
            const dist = ddx * ddx + ddy * ddy
            if (dist < bestDist) {
              bestDist = dist
              bestPoint = p
              bestBucket = bucket
              bestIndex = i
            }
          }
        }
      }

      if (!bestPoint || !bestBucket || bestIndex < 0)
        return undefined
      bestBucket.splice(bestIndex, 1)
      return bestPoint
    }

    function drainRemaining() {
      const rest: Point[] = []
      for (const bucket of grid.values())
        rest.push(...bucket)
      grid.clear()
      return rest
    }

    return { takeClosest, drainRemaining }
  }

  function getPoint(imageData: LoadedImageData, prePointArr: Point[] = []) {
    const { width: imgW, height: imgH } = imageData
    const transform = computeImageTransform(imgW, imgH, width, height, fit, alignX, alignY)
    const drawW = Math.max(1, Math.round(imgW * transform.scaleX))
    const drawH = Math.max(1, Math.round(imgH * transform.scaleY))

    const useScaledSampling = colorSampling === 'scaled' && (drawW !== imgW || drawH !== imgH)
    const sampling = useScaledSampling ? getScaledImageData(imageData, drawW, drawH) : imageData
    const { width: sampleW, height: sampleH, data } = sampling

    // Adaptive pixel step based on screen size and performance
    let step = Math.max(4, Math.floor(pixelStep * (clientWidth > 1200 ? 1.5 : 1)))
    if (typeof maxParticles === 'number' && maxParticles > 0) {
      const est = Math.ceil(sampleW / step) * Math.ceil(sampleH / step)
      if (est > maxParticles) {
        const ratio = Math.sqrt(est / maxParticles)
        step = Math.max(step, Math.ceil(step * ratio))
      }
    }

    const grid = prePointArr.length > 0
      ? buildPointGrid(prePointArr, Math.max(8, Math.round(step)))
      : undefined
    if (grid)
      prePointArr.length = 0

    for (let sy = 0; sy < sampleH; sy += step) {
      for (let sx = 0; sx < sampleW; sx += step) {
        const position = (sampleW * sy + sx) * 4
        const r = data[position]
        const g = data[position + 1]
        const b = data[position + 2]
        const a = data[position + 3]
        // 获取不透明的点
        if (a > alphaThreshold) {
          // map sampled pixel coords to canvas coords (CSS pixels)
          const txCanvas = useScaledSampling
            ? Math.round(sx + transform.offsetX)
            : Math.round(sx * transform.scaleX + transform.offsetX)
          const tyCanvas = useScaledSampling
            ? Math.round(sy + transform.offsetY)
            : Math.round(sy * transform.scaleY + transform.offsetY)
          if (txCanvas < 0 || txCanvas > width || tyCanvas < 0 || tyCanvas > height)
            continue

          // find the closest previous point by position for visual continuity
          const prePoint = grid?.takeClosest(txCanvas, tyCanvas)
          const startX = prePoint?.x ?? Math.random() * width
          const startY = prePoint?.y ?? Math.random() * height
          // Convert alpha from 0-255 to 0-1 for CSS rgba
          const alpha = a / 255
          const rgba = `rgba(${r}, ${g}, ${b}, ${alpha})`
          // Determine starting color for this point.
          // Prefer sampling the canvas at the previous point's current displayed position
          // so we capture the actual pixel color the user sees. Fall back to the
          // prePoint's computed interpolation if sampling isn't possible.
          let initialFillStyle = color
          if (prePoint) {
            if (sampleFromCanvas) {
              try {
                const bx = Math.round(prePoint.x * dpr)
                const by = Math.round(prePoint.y * dpr)
                // clamp to canvas bounds (backing pixels)
                const cx = Math.max(0, Math.min(canvas.width - 1, bx))
                const cy = Math.max(0, Math.min(canvas.height - 1, by))
                const img = ctx.getImageData(cx, cy, 1, 1).data
                const ir = img[0]; const ig = img[1]; const ib = img[2]; const ia = img[3]
                initialFillStyle = `rgba(${ir}, ${ig}, ${ib}, ${ia / 255})`
              }
              catch (e) {
                initialFillStyle = prePoint.interpolateColor(prePoint.initialFillStyle, prePoint.fillStyle, prePoint.progress)
              }
            }
            else {
              initialFillStyle = prePoint.interpolateColor(prePoint.initialFillStyle, prePoint.fillStyle, prePoint.progress)
            }
          }

          const fillStyle = rgba
          if (prePoint) {
            prePoint.reset({
              canvas,
              ctx,
              size: pointSize,
              shape: pointShape,
              jitter,
              w: txCanvas,
              h: tyCanvas,
              x: startX,
              y: startY,
              fillStyle,
              initialFillStyle,
              easing,
              animationDuration: duration,
            })
            pointArr.push(prePoint)
          }
          else {
            // Use the pool when creating points and ensure animation duration is passed through
            pointArr.push(getPointFromPool({
              canvas,
              ctx,
              size: pointSize,
              shape: pointShape,
              jitter,
              w: txCanvas,
              h: tyCanvas,
              x: startX,
              y: startY,
              fillStyle,
              initialFillStyle,
              easing,
              animationDuration: duration,
            }))
          }
        }
      }
    }

    if (grid)
      prePointArr.push(...grid.drainRemaining())
  }

  run()

  insertElement(container, canvas)

  if (interactionOpt.enabled) {
    const toLocal = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const sx = width / rect.width
      const sy = height / rect.height
      interactionState.x = (ev.clientX - rect.left) * sx
      interactionState.y = (ev.clientY - rect.top) * sy
    }

    const onMove = (ev: PointerEvent) => {
      interactionState.active = true
      toLocal(ev)
    }
    const onLeave = () => {
      interactionState.active = false
    }
    const onDown = (ev: PointerEvent) => {
      interactionState.active = true
      toLocal(ev)
      if (interactionOpt.burst.enabled)
        interactionState.burst = { x: interactionState.x, y: interactionState.y }
    }

    canvas.addEventListener('pointermove', onMove, { passive: true })
    canvas.addEventListener('pointerleave', onLeave, { passive: true })
    canvas.addEventListener('pointerdown', onDown, { passive: true })
    removeInteractionListeners = () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
    }
  }

  return () => {
    destroyed = true
    rafStop?.()
    nextRunStop?.()
    removeInteractionListeners?.()

    recyclePoints(pointArr)
    historyStack.length = 0
    removeElement(canvas)
  }
}

interface PointOption {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  size: number
  shape: PointShape
  jitter: number
  w: number
  h: number
  x?: number
  y?: number
  fillStyle?: string
  initialFillStyle?: string
  easing?: Easing
  animationDuration?: number
}
class Point {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  offsetX: number
  offsetY: number
  x: number
  y: number
  baseX: number
  baseY: number
  ox: number
  oy: number
  vx: number
  vy: number
  lastUpdateTime: number
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
  easing: Easing = 'easeInOutCubic'
  shape: PointShape = 'circle'
  jitter = 0
  progress = 0

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
    this.lastUpdateTime = this.startTime
    this.shape = options.shape
    this.jitter = options.jitter
    this.easing = options.easing || 'easeInOutCubic'
    if (typeof animationDuration === 'number' && animationDuration > 0)
      this.animationDuration = animationDuration
    this.progress = 0
    this.baseX = this.x
    this.baseY = this.y
    this.ox = 0
    this.oy = 0
    this.vx = 0
    this.vy = 0
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
    this.lastUpdateTime = this.startTime
    this.shape = options.shape
    this.jitter = options.jitter
    this.easing = options.easing || 'easeInOutCubic'
    if (typeof animationDuration === 'number' && animationDuration > 0)
      this.animationDuration = animationDuration
    this.progress = 0
    this.baseX = this.x
    this.baseY = this.y
    this.ox = 0
    this.oy = 0
    this.vx = 0
    this.vy = 0
    // reset cached parsed colors
    this.__parsedInitialKey = undefined
    this.__parsedTargetKey = undefined
    this.__parsedInitialColor = undefined
    this.__parsedTargetColor = undefined
    return this
  }

  // Apply the selected easing function
  applyEasing(t: number): number {
    if (typeof this.easing === 'function')
      return this.easing(t)

    switch (this.easing) {
      case 'linear': return this.linear(t)
      case 'ease':
      case 'ease-in-out': return this.easeInOutCubic(t)
      case 'ease-in': return this.easeInCubic(t)
      case 'ease-out': return this.easeOutCubic(t)
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
  update(currentTime = performance.now(), interaction?: InteractionFrame) {
    const elapsed = currentTime - this.startTime
    let progress = Math.min(1, elapsed / this.animationDuration)

    // Apply selected easing function
    progress = this.applyEasing(progress)

    this.baseX = this.startX + (this.w - this.startX) * progress
    this.baseY = this.startY + (this.h - this.startY) * progress
    this.completed = progress >= 0.999
    this.progress = progress

    const dtMs = clamp(currentTime - this.lastUpdateTime, 0, 50)
    this.lastUpdateTime = currentTime
    const dt = dtMs / 1000

    if (!interaction || !interaction.active) {
      this.ox = 0
      this.oy = 0
      this.vx = 0
      this.vy = 0
      this.x = this.baseX
      this.y = this.baseY
      return
    }

    let ax = 0
    let ay = 0

    const px = interaction.x
    const py = interaction.y
    const cx = this.baseX + this.ox
    const cy = this.baseY + this.oy
    const dx = cx - px
    const dy = cy - py
    const distSq = dx * dx + dy * dy
    const r = Math.max(1, interaction.radius)
    const rSq = r * r

    if (distSq > 0.0001 && distSq <= rSq) {
      const dist = Math.sqrt(distSq)
      const nx = dx / dist
      const ny = dy / dist
      const t = 1 - dist / r
      const s = interaction.strength * t
      switch (interaction.mode) {
        case 'attract':
          ax -= nx * s
          ay -= ny * s
          break
        case 'vortex':
          ax += -ny * s
          ay += nx * s
          break
        case 'repel':
        default:
          ax += nx * s
          ay += ny * s
          break
      }
    }

    if (interaction.burst) {
      const bdx = cx - interaction.burst.x
      const bdy = cy - interaction.burst.y
      const bDistSq = bdx * bdx + bdy * bdy
      const br = Math.max(1, interaction.burst.radius)
      const brSq = br * br
      if (bDistSq > 0.0001 && bDistSq <= brSq) {
        const bDist = Math.sqrt(bDistSq)
        const bnx = bdx / bDist
        const bny = bdy / bDist
        const bt = 1 - bDist / br
        const impulse = interaction.burst.strength * bt
        this.vx += bnx * impulse
        this.vy += bny * impulse
      }
    }

    // spring back to base position
    ax += -this.ox * interaction.spring
    ay += -this.oy * interaction.spring

    this.vx += ax * dt
    this.vy += ay * dt

    // Exponential damping, stable across frame rates.
    const damp = interaction.damping ** (dt * 60)
    this.vx *= damp
    this.vy *= damp

    this.ox += this.vx * dt
    this.oy += this.vy * dt

    const maxOffset = Math.max(10, r * 1.5)
    this.ox = clamp(this.ox, -maxOffset, maxOffset)
    this.oy = clamp(this.oy, -maxOffset, maxOffset)

    this.x = this.baseX + this.ox
    this.y = this.baseY + this.oy
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
    const a = aInt / 255

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
    // hex: #rgb or #rrggbb
    const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
      const h = hex[1]
      const rr = h.length === 3 ? h[0] + h[0] : h.slice(0, 2)
      const gg = h.length === 3 ? h[1] + h[1] : h.slice(2, 4)
      const bb = h.length === 3 ? h[2] + h[2] : h.slice(4, 6)
      const r = parseInt(rr, 16)
      const g = parseInt(gg, 16)
      const b = parseInt(bb, 16)
      return new Uint8ClampedArray([r, g, b, 255])
    }

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
  render(progress = this.progress) {
    this.ctx.beginPath()
    const j = this.jitter
    const x = j > 0 ? this.x + (Math.random() - 0.5) * j : this.x
    const y = j > 0 ? this.y + (Math.random() - 0.5) * j : this.y
    if (this.shape === 'square') {
      // render as square; we still closePath after fill for consistency
      this.ctx.rect(x - this.size, y - this.size, this.size * 2, this.size * 2)
    }
    else {
      this.ctx.arc(x, y, this.size, 0, Math.PI * 2)
    }

    // Use interpolated color instead of binary switch
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
      const a = aInt / 255
      const rgbaStr = `rgba(${r}, ${g}, ${b}, ${a})`
      this.__cachedColorString = rgbaStr
      this.__cachedColorProgress = progress
      this.ctx.fillStyle = rgbaStr
    }

    this.ctx.fill()
    this.ctx.closePath()
  }

  getProgress(): number {
    if (this.progress >= 0.999 || this.progress > 0)
      return this.progress
    // For best results, use the same progress calculation as the motion
    const elapsed = performance.now() - this.startTime
    const progress = Math.min(1, elapsed / this.animationDuration)
    return this.applyEasing(progress)
  }
}
