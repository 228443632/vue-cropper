import { Component, Prop, Watch, Vue, Emit } from 'vue-property-decorator'

import {
  loadImg,
  getExif,
  resetImg,
  createImgStyle,
  translateStyle,
  loadFile,
  getCropImgData,
  detectionBoundary,
  setAnimation,
} from './common'
import { supportWheel, changeImgSize, isIE } from './changeImgSize'

import './style/index.scss'

import {
  InterfaceLayout,
  InterfaceImgLoad,
  InterfaceModeHandle,
  InterfaceMessageEvent,
  InterfaceAxis,
  InterfaceImgAxis,
  InterfaceLayoutStyle,
  InterfaceTransformStyle,
} from './interface'

import { RESISTANCE, BOUNDARY_DURATION } from './config'

import TouchEvent from './touch'
@Component
export default class VueCropper extends Vue {
  // 高清屏的问题
  ratio: number = window.devicePixelRatio

  // 渲染图片的地址
  imgs: string = ''

  // 是否处于加载中
  isLoading: boolean = true

  canvas: HTMLCanvasElement | null = null

  // 图片真实宽高
  imgLayout: InterfaceLayoutStyle = {
    width: 0,
    height: 0,
  }

  // 外层容器宽高
  wrapLayout: InterfaceLayoutStyle = {
    width: 0,
    height: 0,
  }

  // 图片属性 包含当前坐标轴和缩放
  imgAxis: InterfaceImgAxis = {
    x: 0,
    y: 0,
    scale: 0,
    rotate: 0,
  }

  // 图片css 转化之后的展示效果
  imgExhibitionStyle: InterfaceTransformStyle = {
    width: '',
    height: '',
    transform: '',
  }

  // 截图框的坐标
  cropAxis: InterfaceAxis = {
    x: 0,
    y: 0,
  }

  // 截图框的大小
  cropLayout: InterfaceLayoutStyle = {
    width: 200,
    height: 200,
  }

  // 截图框的样式， 包含外层和里面
  cropExhibitionStyle = {
    div: {},
    img: {},
  }

  // 拖拽
  isDrag: boolean = false

  // 裁剪过程中的一些状态
  // 当前是否可以拖动
  move: boolean = true

  // 当前正在拖拽生成截图框
  crop: boolean = false

  // 处于生成了截图的状态
  cropping: boolean = true

  // 当前截图框是否处于动画状态 即回弹状态
  isCropAnimate: boolean = false

  // 当前图片是否处于动画状态 即回弹状态
  isImgAnimate: boolean = false

  // 截图框是否已经被拖出出限定的范围， 添加阻力
  isCropCrossing: boolean = false

  // 图片是否已经被拖出出限定的范围， 添加阻力
  isImgCrossing: boolean = false

  $refs!: {
    canvas: HTMLCanvasElement
    cropper: HTMLElement
    cropperImg: HTMLElement
    cropperBox: HTMLElement
  }

  cropImg: TouchEvent | null = null

  cropBox: TouchEvent | null = null

  waitingImgChecked: boolean = false

  setWaitFunc: number = 0

  // 图片地址
  @Prop({ default: '' })
  readonly img!: string

  // 外层容器宽高
  @Prop({
    default: () => ({
      width: '100%',
      height: '100%',
    }),
  })
  wrapper!: InterfaceLayout

  // 主题色
  @Prop({ default: '#fff' })
  readonly color!: string

  // 滤镜函数
  @Prop({ default: null })
  readonly filter!: (canvas: HTMLCanvasElement) => HTMLCanvasElement | null

  // 输出的图片格式
  @Prop({ default: 'png' })
  readonly outputType!: string

  /*
      图片布局方式 mode 实现和css背景一样的效果
      contain  居中布局 默认不会缩放 保证图片在容器里面 mode: 'contain'
      cover    拉伸布局 填充整个容器  mode: 'cover'
      original 保持图片原始比例不变
      宽度自适应 高度固定  mode: '50px auto'
      宽度固定 高度自适应 mode: 'auto 50px'
  */
  @Prop({ default: 'contain' })
  readonly mode!: keyof InterfaceModeHandle

  // 截图框的颜色
  @Prop({ default: '#fff' })
  readonly cropColor!: string

  @Prop({ default: 0 })
  readonly defaultRotate!: number

  // 截图框是否应该限制在图片里面
  @Prop({ default: false })
  readonly centerBox!: boolean

  @Watch('img')
  onImgChanged(val: string) {
    if (val && val !== this.imgs) {
      this.checkedImg(val)
    }
  }

  @Watch('imgs')
  onImgsChanged(val: string) {
    if (val) {
      this.$nextTick(() => {
        this.bindMoveImg()
      })

      if (this.cropping) {
        this.$nextTick(() => {
          this.bindMoveCrop()
        })
      }
    }
  }

  @Watch('cropping')
  onCroppingChanged(val: boolean) {
    if (val) {
      this.$nextTick(() => {
        this.bindMoveCrop()
      })
    }
  }

  @Watch('filter')
  onFilterChanged() {
    this.isLoading = true
    this.checkedImg(this.img)
  }

  @Watch('mode')
  onModeChanged() {
    this.checkedImg(this.img)
  }

  @Watch('defaultRotate')
  onDefaultRotateChange(val: number) {
    this.setRotate(val)
  }

  // 消息通知
  @Emit('img-load')
  imgLoadEmit(obj: InterfaceImgLoad): InterfaceImgLoad {
    return obj
  }

  // 消息通知
  @Emit('img-upload')
  imgUploadEmit(url: string): string {
    return url
  }

  drop(e: DragEvent) {
    e.preventDefault()
    const dataTransfer = e.dataTransfer as DataTransfer
    this.isDrag = false
    loadFile(dataTransfer.files[0]).then(res => {
      if (res) {
        // 不要自己更新
        // this.checkedImg(res)
        this.imgUploadEmit(res)
      }
    })
  }

  dragover(e: Event) {
    e.preventDefault()
    this.isDrag = true
  }

  dragend(e: Event) {
    e.preventDefault()
    this.isDrag = false
  }

  // 检查图片, 修改图片为正确角度
  async checkedImg(url: string) {
    this.isLoading = true
    this.imgs = ''
    this.canvas = null
    let img: HTMLImageElement
    try {
      img = await loadImg(url)
      this.imgLoadEmit({
        type: 'success',
        message: '图片加载成功',
      })
    } catch (error) {
      this.imgLoadEmit({
        type: 'error',
        message: `图片加载失败${error}`,
      })
      this.isLoading = false
      return false
    }
    console.log(`图片初次加载成功, time is ${~~window.performance.now()}`)
    // 图片加载成功之后的操作 获取图片旋转角度
    let result = {
      orientation: -1,
    }
    try {
      result = await getExif(img)
    } catch (error) {
      console.log(error)
      result.orientation = 1
    }
    const orientation = result.orientation || -1
    console.log(`图片加载成功,orientation为${orientation}, time is ${~~window.performance.now()}`)

    // 图片不需要进行处理的
    // if ((orientation === 1 || orientation === -1) && !this.filter) {
    //   try {
    //     await this.renderImgLayout(url)
    //   } catch (error) {
    //     console.error(error)
    //   }
    //   this.imgs = this.img
    //   this.isLoading = false
    //   return
    // }

    let canvas: HTMLCanvasElement = document.createElement('canvas')
    try {
      canvas = await resetImg(img, canvas, orientation)
    } catch (error) {
      console.error(error)
    }
    this.canvas = canvas
    this.renderFilter()
  }

  // 滤镜渲染
  renderFilter() {
    if (this.filter) {
      if (!this.canvas) {
        return
      }
      let canvas = this.canvas
      canvas = this.filter(canvas) || canvas
      this.canvas = canvas
      console.log(`图片滤镜渲染成功, time is ${~~window.performance.now()}`)
    }
    this.createImg()
  }

  // 生成新图片
  createImg() {
    if (!this.canvas) {
      return
    }
    try {
      this.canvas.toBlob(
        async blob => {
          if (blob) {
            console.log(`新图片渲染成功, time is ${~~window.performance.now()}`)
            URL.revokeObjectURL(this.imgs)
            const url = URL.createObjectURL(blob)
            let scale = 1
            try {
              scale = await this.renderImgLayout(url)
            } catch (e) {
              console.error(e)
            }
            const style = translateStyle({
              scale,
              imgStyle: { ...this.imgLayout },
              layoutStyle: { ...this.wrapLayout },
              rotate: this.defaultRotate,
            })
            this.imgExhibitionStyle = style.imgExhibitionStyle
            this.imgAxis = style.imgAxis
            this.imgs = url
            // 渲染截图框
            if (this.cropping) {
              this.renderCrop()
            }
            this.reboundImg()
            this.isLoading = false
          } else {
            this.imgs = ''
            this.isLoading = false
          }
        },
        `image/${this.outputType}`,
        1,
      )
    } catch (e) {
      console.error(e)
      this.isLoading = false
    }
  }

  // 渲染图片布局
  async renderImgLayout(url: string): Promise<number> {
    let img: HTMLImageElement
    try {
      img = await loadImg(url)
      this.imgLoadEmit({
        type: 'success',
        message: '图片加载成功',
      })
    } catch (error) {
      this.imgLoadEmit({
        type: 'error',
        message: `图片加载失败${error}`,
      })
      this.isLoading = false
      return 1
    }
    const wrapper = {
      width: 0,
      height: 0,
    }
    wrapper.width = Number(
      (window.getComputedStyle(this.$refs.cropper).width || '').replace('px', ''),
    )
    wrapper.height = Number(
      (window.getComputedStyle(this.$refs.cropper).height || '').replace('px', ''),
    )
    this.imgLayout = {
      width: img.width,
      height: img.height,
    }
    this.wrapLayout = { ...wrapper }

    return createImgStyle({ ...this.imgLayout }, wrapper, this.mode)
  }

  // 鼠标移入截图组件
  mouseInCropper() {
    if (isIE) {
      window.addEventListener(supportWheel, this.mouseScroll)
    } else {
      window.addEventListener(supportWheel, this.mouseScroll, {
        passive: false,
      })
    }
  }

  // 鼠标移出截图组件
  mouseOutCropper() {
    // console.log('remove')
    window.removeEventListener(supportWheel, this.mouseScroll)
  }

  // 鼠标滚动事件
  mouseScroll(e: Event) {
    e.preventDefault()
    const scale = changeImgSize(e, this.imgAxis.scale, this.imgLayout)
    this.setScale(scale)
    // console.log('scroll')
  }

  // 修改图片缩放比例函数
  setScale(scale: number, keep: boolean = false) {
    // 保持当前坐标比例
    const axis = {
      x: this.imgAxis.x,
      y: this.imgAxis.y,
    }
    if (!keep) {
      axis.x -= (this.imgLayout.width * (scale - this.imgAxis.scale)) / 2
      axis.y -= (this.imgLayout.height * (scale - this.imgAxis.scale)) / 2
    }

    const style = translateStyle(
      {
        scale,
        imgStyle: { ...this.imgLayout },
        layoutStyle: { ...this.wrapLayout },
        rotate: this.imgAxis.rotate,
      },
      axis,
    )
    this.imgExhibitionStyle = style.imgExhibitionStyle
    this.imgAxis = style.imgAxis
    // 设置完成图片大小后去校验 图片的坐标轴
    clearTimeout(this.setWaitFunc)
    this.setWaitFunc = setTimeout(() => {
      this.reboundImg()
      this.waitingImgChecked = false
    }, BOUNDARY_DURATION)
  }

  // 移动图片
  moveImg(message: InterfaceMessageEvent) {
    // 拿到的是变化之后的坐标轴
    if (message.change) {
      // console.log(message.change)
      // 去更改图片的位置
      const axis = {
        x: message.change.x + this.imgAxis.x,
        y: message.change.y + this.imgAxis.y,
      }

      // if (this.centerBox) {
      //   // 这个时候去校验下是否图片已经被拖拽出了不可限制区域，添加回弹
      //   const crossing = detectionBoundary(
      //     { ...this.cropAxis },
      //     { ...this.cropLayout },
      //     { ...this.imgAxis },
      //     { ...this.imgLayout },
      //   )

      //   if (crossing.landscape !== '' || crossing.portrait !== '') {
      //     // 施加拖动阻力 ？是否需要添加越来越大的阻力
      //     axis.x = this.imgAxis.x + message.change.x * RESISTANCE
      //     axis.y = this.imgAxis.y + message.change.y * RESISTANCE
      //   }
      // }

      this.setImgAxis(axis)
    }
  }

  // 设置图片坐标
  setImgAxis(axis: InterfaceAxis) {
    const style = translateStyle(
      {
        scale: this.imgAxis.scale,
        imgStyle: { ...this.imgLayout },
        layoutStyle: { ...this.wrapLayout },
        rotate: this.imgAxis.rotate,
      },
      axis,
    )
    this.imgExhibitionStyle = style.imgExhibitionStyle
    this.imgAxis = style.imgAxis
  }

  // 回弹图片
  reboundImg(): void {
    if (!this.centerBox) {
      return
    }
    // 这个时候去校验下是否图片已经被拖拽出了不可限制区域，添加回弹
    const crossing = detectionBoundary(
      { ...this.cropAxis },
      { ...this.cropLayout },
      { ...this.imgAxis },
      { ...this.imgLayout },
    )
    // console.log(crossing)
    if (this.imgAxis.scale < crossing.scale) {
      setAnimation(this.imgAxis.scale, crossing.scale, BOUNDARY_DURATION, value => {
        this.setScale(value, true)
      })
    }

    if (crossing.landscape === 'left') {
      setAnimation(this.imgAxis.x, crossing.boundary.left, BOUNDARY_DURATION, value => {
        // console.log('set left', value)
        this.setImgAxis({
          x: value,
          y: this.imgAxis.y,
        })
      })
    }

    if (crossing.landscape === 'right') {
      setAnimation(this.imgAxis.x, crossing.boundary.right, BOUNDARY_DURATION, value => {
        this.setImgAxis({
          x: value,
          y: this.imgAxis.y,
        })
      })
    }

    if (crossing.portrait === 'top') {
      setAnimation(this.imgAxis.y, crossing.boundary.top, BOUNDARY_DURATION, value => {
        // console.log('set top', value)
        this.setImgAxis({
          x: this.imgAxis.x,
          y: value,
        })
      })
    }

    if (crossing.portrait === 'bottom') {
      setAnimation(this.imgAxis.y, crossing.boundary.bottom, BOUNDARY_DURATION, value => {
        this.setImgAxis({
          x: this.imgAxis.x,
          y: value,
        })
      })
    }

    console.log('可以开始校验位置，回弹了')
  }

  // 绑定拖拽
  bindMoveImg(): void {
    this.unbindMoveImg()
    const domImg = this.$refs.cropperImg
    this.cropImg = new TouchEvent(domImg)
    // 图片拖拽绑定
    this.cropImg.on('down-to-move', this.moveImg)
    this.cropImg.on('up', this.reboundImg)
  }

  unbindMoveImg(): void {
    if (this.cropImg) {
      this.cropImg.off('down-to-move', this.moveImg)
      this.cropImg.off('up', this.reboundImg)
    }
  }

  bindMoveCrop(): void {
    this.unbindMoveCrop()
    const domBox = this.$refs.cropperBox
    this.cropBox = new TouchEvent(domBox)
    this.cropBox.on('down-to-move', this.moveCrop)
    this.cropBox.on('up', this.reboundImg)
    this.cropImg = null
  }

  unbindMoveCrop(): void {
    if (this.cropBox) {
      this.cropBox.off('down-to-move', this.moveCrop)
      this.cropBox.off('up', this.reboundImg)
      this.cropBox = null
    }
  }

  // 设置旋转角度
  setRotate(rotate: number) {
    const { x, y, scale } = this.imgAxis
    const axis = { x, y }
    const style = translateStyle(
      {
        scale,
        imgStyle: { ...this.imgLayout },
        layoutStyle: { ...this.wrapLayout },
        rotate,
      },
      axis,
    )
    this.imgExhibitionStyle = style.imgExhibitionStyle
    this.imgAxis = style.imgAxis
  }

  // 获取截图信息
  getCropData(type?: string) {
    // 组合数据
    const obj = {
      type: type ? type : 'base64',
      outputType: this.outputType,
      url: this.imgs,
      imgAxis: { ...this.imgAxis },
      imgLayout: { ...this.imgLayout },
      cropLayout: { ...this.cropLayout },
      cropAxis: { ...this.cropAxis },
      cropping: this.cropping,
    }
    return getCropImgData(obj)
  }

  // 渲染截图框
  renderCrop(axis?: InterfaceAxis): void {
    // 如果没有指定截图框的容器位置， 默认截图框为居中布局
    const { width, height } = this.wrapLayout
    let cropW = this.cropLayout.width
    let cropH = this.cropLayout.height
    cropW = cropW < width ? cropW : width
    cropH = cropW < height ? cropH : height
    const defaultAxis: InterfaceAxis = {
      x: (width - cropW) / 2,
      y: (height - cropH) / 2,
    }
    // 校验截图框位置
    if (axis) {
      this.checkedCrop(axis)
    } else {
      this.checkedCrop(defaultAxis)
    }
  }

  // 移动截图框
  moveCrop(message: InterfaceMessageEvent) {
    // 拿到的是变化之后的坐标轴
    if (message.change) {
      const axis = {
        x: message.change.x + this.cropAxis.x,
        y: message.change.y + this.cropAxis.y,
      }
      this.checkedCrop(axis)
    }
  }

  // 检查截图框位置
  checkedCrop(axis: InterfaceAxis) {
    // 截图了默认不允许超过容器
    const maxLeft = 0
    const maxTop = 0
    const maxRight = this.wrapLayout.width - this.cropLayout.width
    const maxBottom = this.wrapLayout.height - this.cropLayout.height
    if (axis.x < maxLeft) {
      axis.x = maxLeft
    }

    if (axis.y < maxTop) {
      axis.y = maxTop
    }

    if (axis.x > maxRight) {
      axis.x = maxRight
    }

    if (axis.y > maxBottom) {
      axis.y = maxBottom
    }

    this.cropAxis = axis
    this.cropping = true
  }

  // 回弹截图框, 如果校验不通过那么截图框需要在指定时间弹回正常的位置

  // 清除截图框
  clearCrop() {
    this.cropAxis = {
      x: 0,
      y: 0,
    }
    this.cropping = false
  }

  mounted(): void {
    if (this.img) {
      this.checkedImg(this.img)
    } else {
      this.imgs = ''
    }

    // 添加拖拽上传
    const dom = this.$refs.cropper
    dom.addEventListener('dragover', this.dragover, false)
    dom.addEventListener('dragend', this.dragend, false)
    dom.addEventListener('drop', this.drop, false)
  }

  destroy(): void {
    this.$refs.cropper.removeEventListener('drop', this.drop, false)
    this.$refs.cropper.removeEventListener('dragover', this.dragover, false)
    this.$refs.cropper.removeEventListener('dragend', this.dragend, false)
    this.unbindMoveImg()
    this.unbindMoveCrop()
    console.log('destroy')
  }

  // 计算拖拽的 class 名
  computedClassDrag(): string {
    const className = ['cropper-drag-box']
    if (this.move && !this.crop) {
      className.push('cropper-move')
    }

    if (this.crop) {
      className.push('cropper-crop')
    }

    if (this.cropping) {
      className.push('cropper-modal')
    }
    return className.join(' ')
  }

  // 计算截图框外层样式
  getCropBoxStyle(): InterfaceTransformStyle {
    const style = {
      width: `${this.cropLayout.width}px`,
      height: `${this.cropLayout.height}px`,
      transform: `translate3d(${this.cropAxis.x}px, ${this.cropAxis.y}px, 0)`,
    }
    this.cropExhibitionStyle.div = style
    return style
  }

  // 计算截图框图片的样式
  getCropImgStyle(): InterfaceTransformStyle {
    const scale = this.imgAxis.scale
    // 图片放大所带来的扩张坐标补充  加   图片坐标和截图坐标的差值
    const x =
      ((this.imgLayout.width * (scale - 1)) / 2 + (this.imgAxis.x - this.cropAxis.x)) / scale

    const y =
      ((this.imgLayout.height * (scale - 1)) / 2 + (this.imgAxis.y - this.cropAxis.y)) / scale
    // console.log({... this.imgAxis}, '---box')
    const style = {
      width: `${this.imgLayout.width}px`,
      height: `${this.imgLayout.height}px`,
      transform: `scale(${scale}, ${scale}) translate3d(${x}px, ${y}px, 0) rotateZ(${this.imgAxis.rotate}deg)`,
    }
    this.cropExhibitionStyle.img = style
    return style
  }

  render() {
    return (
      <section
        class="vue-cropper"
        style={this.wrapper}
        ref="cropper"
        onmouseover={this.mouseInCropper}
        onmouseout={this.mouseOutCropper}
      >
        <section class="cropper-tips">
          <p>
            截图框 x: {this.cropAxis.x} y: {this.cropAxis.y}
          </p>
          <p>
            截图框 w: {this.cropLayout.width} y: {this.cropLayout.height}
          </p>
          <p>
            图片坐标 x: {this.imgAxis.x} y: {this.imgAxis.y}
          </p>
          <p>旋转角度 {this.imgAxis.rotate} </p>
        </section>
        {this.imgs ? (
          <section class="cropper-box cropper-fade-in">
            {/* 图片展示框 */}
            <section class="cropper-box-canvas" style={this.imgExhibitionStyle}>
              <img src={this.imgs} alt="vue-cropper" />
            </section>

            {/* 图片拖拽容器和截图框拖拽生成的，遮罩 */}
            <section class={this.computedClassDrag()} ref="cropperImg" />

            {/* 截图框展示 */}
            {this.cropping ? (
              <section class="cropper-crop-box" style={this.getCropBoxStyle()}>
                <span class="cropper-view-box">
                  <img src={this.imgs} style={this.getCropImgStyle()} alt="cropper-img" />
                </span>
                <span class="cropper-face cropper-move" ref="cropperBox" />
              </section>
            ) : (
              ''
            )}
          </section>
        ) : (
          ''
        )}

        {/* 加载动画 */}
        {this.isLoading ? (
          <section class="cropper-loading">
            <p class="cropper-loading-spin">
              <i>
                <svg
                  viewBox="0 0 1024 1024"
                  focusable="false"
                  data-icon="loading"
                  width="1.5em"
                  height="1.5em"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M988 548c-19.9 0-36-16.1-36-36 0-59.4-11.6-117-34.6-171.3a440.45 440.45 0 0 0-94.3-139.9 437.71 437.71 0 0 0-139.9-94.3C629 83.6 571.4 72 512 72c-19.9 0-36-16.1-36-36s16.1-36 36-36c69.1 0 136.2 13.5 199.3 40.3C772.3 66 827 103 874 150c47 47 83.9 101.8 109.7 162.7 26.7 63.1 40.2 130.2 40.2 199.3.1 19.9-16 36-35.9 36z" />
                </svg>
              </i>
              <span />
            </p>
          </section>
        ) : (
          ''
        )}
      </section>
    )
  }
}
