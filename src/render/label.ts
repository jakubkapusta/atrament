import { DANGER, JAR_H, JAR_W, WATER } from '../game/game';

/**
 * Enamel print on the glass: ml graduation, MAX mark and a small maker's mark.
 * Texture u spans cylinder angle [0.05, 1.25] rad (front-right), v spans y ∈ [H, 0].
 * Drawn in "arc units" so text keeps its proportions before cylindrical projection.
 */
export function makeLabelCanvas(): HTMLCanvasElement {
  const Ro = JAR_W / 2 + 0.2;
  const arc = Ro * 1.2; // world arc length covered by the texture
  const ppu = 220; // pixels per world unit
  const c = document.createElement('canvas');
  c.width = Math.round(arc * ppu);
  c.height = Math.round(JAR_H * ppu);
  const g = c.getContext('2d')!;
  g.setTransform(ppu, 0, 0, ppu, 0, 0);
  const Y = (y: number) => JAR_H - y; // world y → canvas y
  const white = 'rgba(38,34,32,0.82)'; // dark enamel reads against the lightbox
  g.fillStyle = white;
  g.strokeStyle = white;
  g.lineCap = 'butt';
  // text is drawn untransformed with pixel font sizes (tiny fractional fonts render badly on Safari)
  const text = (str: string, x: number, y: number, size: number, font: string, base: CanvasTextBaseline = 'alphabetic') => {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.font = font.replace('$', `${(size * ppu).toFixed(1)}px`);
    g.textBaseline = base;
    g.fillText(str, x * ppu, y * ppu);
    g.restore();
  };

  const x0 = 0.25;
  // graduation: 1 unit ≈ 100 ml
  for (let i = 1; i <= 18; i++) {
    const y = i * 0.5;
    if (y > WATER - 0.2) break;
    const major = i % 2 === 0;
    g.lineWidth = major ? 0.035 : 0.025;
    g.beginPath();
    g.moveTo(x0, Y(y));
    g.lineTo(x0 + (major ? 0.55 : 0.3), Y(y));
    g.stroke();
    if (major) {
      text(String(i * 50), x0 + 0.68, Y(y) + 0.01, 0.23, '600 $ Inter, system-ui, sans-serif', 'middle');
    }
  }
  text('ml', x0 + 0.68, Y(WATER - 0.35), 0.19, '500 $ Inter, system-ui, sans-serif');

  // MAX label (the line itself is drawn in the shader)
  g.fillStyle = 'rgba(214,40,32,0.95)';
  text('MAX', x0 + 0.7, Y(DANGER) - 0.06, 0.22, '700 $ Inter, system-ui, sans-serif', 'bottom');

  // maker's mark near the bottom
  g.fillStyle = white;
  text('Atrament', x0 + 1.55, Y(0.95), 0.36, 'italic 600 $ Fraunces, Georgia, serif');
  text('BOROSILICATE 3.3 · ±5% · 20°C', x0 + 1.56, Y(0.62), 0.13, '500 $ Inter, system-ui, sans-serif');
  g.lineWidth = 0.02;
  g.beginPath();
  g.arc(x0 + 1.25, Y(0.82), 0.16, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(x0 + 1.25, Y(0.82) - 0.1);
  g.quadraticCurveTo(x0 + 1.35, Y(0.82) + 0.02, x0 + 1.25, Y(0.82) + 0.09);
  g.quadraticCurveTo(x0 + 1.15, Y(0.82) + 0.02, x0 + 1.25, Y(0.82) - 0.1);
  g.fill();
  return c;
}
