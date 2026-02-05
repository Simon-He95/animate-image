export type ImageFit = 'none' | 'contain' | 'cover' | 'stretch'

export type Align = 'start' | 'center' | 'end'

export type PointShape = 'circle' | 'square'

export type EasingName =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInElastic'
  | 'easeOutElastic'
  | 'easeInOutElastic'
  | 'easeInBounce'
  | 'easeOutBounce'
  | 'easeInOutBounce'

export type Easing = EasingName | ((t: number) => number)

export type InteractionMode = 'none' | 'repel' | 'attract' | 'vortex'

export type ColorSampling = 'source' | 'scaled'

export interface BurstOptions {
  radius?: number
  strength?: number
}

export interface InteractionOptions {
  enabled?: boolean
  mode?: InteractionMode
  radius?: number
  strength?: number
  /**
   * 0..1, closer to 1 keeps velocity longer.
   */
  damping?: number
  /**
   * Spring strength pulling offsets back to 0.
   */
  spring?: number
  burst?: boolean | BurstOptions
}

export interface AnimateImageOptions {
  images: string[]
  width?: number
  height?: number
  container?: string

  duration?: number
  delay?: number
  infinity?: boolean
  isUpdateFromLastPosition?: boolean

  background?: string

  pixelStep?: number
  alphaThreshold?: number
  maxParticles?: number

  pointSize?: number
  pointShape?: PointShape
  jitter?: number

  easing?: Easing

  fit?: ImageFit
  alignX?: Align
  alignY?: Align

  compositeOperation?: GlobalCompositeOperation
  /**
   * 1 = clear each frame (no trails); 0.9 means keep ~90% previous frame.
   */
  fade?: number

  /**
   * If true, sample canvas pixels to pick initial colors when morphing (may fail on tainted canvas).
   */
  sampleFromCanvas?: boolean

  /**
   * Pointer interaction (repel/attract/vortex) + click burst.
   */
  interaction?: boolean | InteractionOptions

  /**
   * How to sample colors when the image is scaled by `fit`.
   * - `scaled`: resample the image to the drawn size first (closer to what the user sees)
   * - `source`: sample from original pixels (more "pixel-art" and faster)
   */
  colorSampling?: ColorSampling
}

export type AnimateImageCleanup = () => void
