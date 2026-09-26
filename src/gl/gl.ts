export interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
  tx: number; // texel size
  ty: number;
}

export interface MRT {
  fbo: WebGLFramebuffer;
  texs: WebGLTexture[];
  w: number;
  h: number;
}

export interface Double {
  read: Target;
  write: Target;
  swap(): void;
  w: number;
  h: number;
  tx: number;
  ty: number;
}

type UniformValue = number | boolean | ArrayLike<number> | WebGLTexture;

export class Program {
  readonly prog: WebGLProgram;
  private u = new Map<string, { loc: WebGLUniformLocation; type: number; size: number }>();
  private unit = 0;
  constructor(private gl: WebGL2RenderingContext, vs: string, fs: string, name = 'program') {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, name));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, name));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Link error (${name}): ${gl.getProgramInfoLog(p)}`);
    }
    this.prog = p;
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!;
      const key = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(p, info.name);
      if (loc) this.u.set(key, { loc, type: info.type, size: info.size });
    }
  }
  use() {
    this.gl.useProgram(this.prog);
    this.unit = 0;
    return this;
  }
  set(name: string, v: UniformValue) {
    const u = this.u.get(name);
    if (!u) return this;
    const gl = this.gl;
    switch (u.type) {
      case gl.FLOAT:
        if (u.size > 1) gl.uniform1fv(u.loc, v as Float32List);
        else gl.uniform1f(u.loc, v as number);
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(u.loc, v as Float32List);
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(u.loc, v as Float32List);
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(u.loc, v as Float32List);
        break;
      case gl.INT:
      case gl.BOOL:
        gl.uniform1i(u.loc, Number(v));
        break;
      case gl.SAMPLER_2D:
        gl.activeTexture(gl.TEXTURE0 + this.unit);
        gl.bindTexture(gl.TEXTURE_2D, v as WebGLTexture);
        gl.uniform1i(u.loc, this.unit++);
        break;
    }
    return this;
  }
  setAll(obj: Record<string, UniformValue>) {
    for (const k in obj) this.set(k, obj[k]);
    return this;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, name: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) || '';
    const lines = src.split('\n');
    const m = /ERROR: \d+:(\d+)/.exec(log);
    const ctx = m ? lines.slice(Math.max(0, +m[1] - 3), +m[1] + 2).join('\n') : '';
    throw new Error(`Shader error (${name}, ${type === gl.VERTEX_SHADER ? 'vs' : 'fs'}): ${log}\n${ctx}`);
  }
  return s;
}

export class GLX {
  readonly gl: WebGL2RenderingContext;
  readonly hdr: boolean;
  readonly fmt: { internal: number; format: number; type: number };
  private tri: WebGLVertexArrayObject;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 niedostępny');
    this.gl = gl;
    const cbf = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.hdr = !!cbf;
    this.fmt = this.hdr
      ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }
      : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };

    this.tri = gl.createVertexArray()!;
    gl.bindVertexArray(this.tri);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  program(vs: string, fs: string, name?: string) {
    return new Program(this.gl, vs, fs, name);
  }

  texture(w: number, h: number, filter: number, internal = this.fmt.internal, format = this.fmt.format, type = this.fmt.type, wrap?: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap ?? gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap ?? gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    return t;
  }

  target(w: number, h: number, filter: number = this.gl.LINEAR): Target {
    const gl = this.gl;
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const tex = this.texture(w, h, filter);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { fbo, tex, w, h, tx: 1 / w, ty: 1 / h };
  }

  double(w: number, h: number, filter: number = this.gl.LINEAR): Double {
    let a = this.target(w, h, filter);
    let b = this.target(w, h, filter);
    return {
      get read() {
        return a;
      },
      get write() {
        return b;
      },
      swap() {
        const t = a;
        a = b;
        b = t;
      },
      w: a.w,
      h: a.h,
      tx: a.tx,
      ty: a.ty,
    };
  }

  mrt(w: number, h: number, n: number): MRT {
    const gl = this.gl;
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const texs: WebGLTexture[] = [];
    const bufs: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = this.texture(w, h, gl.LINEAR);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      texs.push(t);
      bufs.push(gl.COLOR_ATTACHMENT0 + i);
    }
    gl.drawBuffers(bufs);
    return { fbo, texs, w, h };
  }

  deleteTarget(t: Target | undefined) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  bind(t: { fbo: WebGLFramebuffer; w: number; h: number } | null, w?: number, h?: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : w!, t ? t.h : h!);
  }

  fullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
