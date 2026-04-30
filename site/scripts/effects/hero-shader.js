import {
  ShaderMount,
  meshGradientFragmentShader,
  getShaderColorFromString,
  ShaderFitOptions
} from '@paper-design/shaders';

export function initHeroShader() {
  const container = document.getElementById('hero-shader');
  if (!container) return;

  // Respect user's motion preferences
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    container.style.display = 'none';
    return;
  }

  // Liquid ink mesh gradient
  const shader = new ShaderMount(
    container,
    meshGradientFragmentShader,
    {
      // Colors - liquid ink effect (grayscale tones for editorial look)
      u_colors: [
        getShaderColorFromString('#ffffff'),
        getShaderColorFromString('#e8e4df'),
        getShaderColorFromString('#b5b0a8'),
        getShaderColorFromString('#1a1a1a'),
      ],
      u_colorsCount: 4,

      // Effect parameters
      u_distortion: 1.0,
      u_swirl: 0.2,
      u_grainMixer: 0,
      u_grainOverlay: 0,

      // Sizing uniforms (required by mesh gradient)
      u_fit: ShaderFitOptions.cover,
      u_scale: 1,
      u_rotation: 0,
      u_offsetX: 0,
      u_offsetY: 0,
      u_originX: 0.5,
      u_originY: 0.5,
      u_worldWidth: 0,
      u_worldHeight: 0,
    },
    undefined,
    1.0 // speed
  );

  // Cleanup
  window.addEventListener('beforeunload', () => {
    shader.dispose();
  });
}
