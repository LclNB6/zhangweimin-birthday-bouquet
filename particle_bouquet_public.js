import * as THREE from "three";
import { GPUComputationRenderer } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/misc/GPUComputationRenderer.js";


const COMPACT_VIEW =
  window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 900;
const TEXTURE_SIZE = COMPACT_VIEW ? 384 : 512;
const PARTICLE_COUNT = TEXTURE_SIZE * TEXTURE_SIZE;
const TAU = Math.PI * 2;
const MODEL_CENTER_Z = 0.0;
const CUBE_ROTATION_SPEED = 0.22;
const CUBE_PITCH = Math.PI;
const SCENE_DOWN_CM = 0.0;
const CSS_PIXELS_PER_CM = 96 / 2.54;

const canvas = document.getElementById("scene");
const errorPanel = document.getElementById("error");

const PINK = [1.0, 0.36, 0.49];
const ROSE_RED = [0.78, 0.055, 0.17];
const PALE = [1.0, 0.78, 0.82];
const WHITE = [0.93, 0.91, 0.94];
const BLUE = [0.31, 0.64, 0.82];
const STEM = [0.18, 0.40, 0.26];
const LIGHT_DIRECTION = normalize([-0.35, -0.62, 0.70]);


function showError(message) {
  canvas.style.display = "none";
  errorPanel.style.display = "grid";
  errorPanel.textContent = message;
}


function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}


function mixColor(left, right, amount) {
  return [
    left[0] + (right[0] - left[0]) * amount,
    left[1] + (right[1] - left[1]) * amount,
    left[2] + (right[2] - left[2]) * amount,
  ];
}


function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}


function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}


function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}


function samplePetal(petal, t, v) {
  const widthProfile = Math.sin(Math.PI * (0.06 + 0.88 * t));
  const halfWidth = petal.width * (0.14 + 0.86 * widthProfile);
  const radial =
    petal.baseRadius + petal.length * t + petal.curl * t * t * t;
  const tangent = v * halfWidth;
  const cosine = Math.cos(petal.angle);
  const sine = Math.sin(petal.angle);

  return [
    cosine * radial - sine * tangent,
    sine * radial + cosine * tangent,
    petal.zBase +
      petal.rise * Math.pow(t, 0.82) +
      petal.edgeLift * v * v * Math.sin(Math.PI * t * 0.72) -
      petal.tipDrop * Math.pow(t, 4),
  ];
}


function petalNormal(petal, t, v) {
  const epsilon = 0.008;
  const along = subtract(
    samplePetal(petal, t + epsilon, v),
    samplePetal(petal, t - epsilon, v),
  );
  const across = subtract(
    samplePetal(petal, t, v + epsilon),
    samplePetal(petal, t, v - epsilon),
  );
  return normalize(cross(along, across));
}


function buildRosePetals() {
  const heads = [
    [-0.66, 0.24, 0.84, 0.60, 0.20, 0.20],
    [0.00, 0.38, 0.92, 0.66, 0.84, 0.26],
    [0.66, 0.22, 0.84, 0.60, 1.42, 0.18],
    [-0.62, -0.08, 0.68, 0.64, 2.04, 0.34],
    [0.00, -0.27, 0.60, 0.94, 2.72, 0.52],
    [0.62, -0.07, 0.68, 0.64, 3.31, 0.34],
    [0.03, 0.04, 1.02, 0.56, 3.96, 0.28],
  ].map(([x, y, z, scale, rotation, tilt]) => ({
    x,
    y,
    z,
    scale,
    rotation,
    tilt,
  }));
  const headWeightTotal = heads.reduce(
    (sum, head) => sum + head.scale * head.scale,
    0,
  );
  const pickHead = () => {
    let value = Math.random() * headWeightTotal;
    for (const head of heads) {
      value -= head.scale * head.scale;
      if (value <= 0) return head;
    }
    return heads[heads.length - 1];
  };

  const layerCounts = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const goldenAngle = Math.PI * (3.0 - Math.sqrt(5.0));
  const petals = [];

  for (const head of heads) {
    for (let layer = 0; layer < layerCounts.length; layer += 1) {
      const layerT = layer / (layerCounts.length - 1);
      const petalCount = layerCounts[layer];

      for (let index = 0; index < petalCount; index += 1) {
        petals.push({
          head,
          weight: head.scale * head.scale,
          layer: layerT,
          angle:
            head.rotation +
            layer * goldenAngle +
            (TAU * index) / petalCount +
            randomBetween(-0.04, 0.04),
          baseRadius: 0.020 + 0.070 * layerT,
          length: 0.36 + 1.02 * Math.pow(layerT, 0.80),
          width: 0.145 + 0.335 * Math.pow(layerT, 0.68),
          rise: 1.30 - 0.70 * layerT,
          edgeLift: 0.085 + 0.085 * (1.0 - layerT),
          curl: 0.025 + 0.075 * layerT,
          tipDrop: 0.025 + 0.15 * layerT,
          zBase: 0.15 + 0.12 * (1.0 - layerT),
        });
      }
    }
  }

  const petalWeightTotal = petals.reduce((sum, petal) => sum + petal.weight, 0);
  return { heads, petals, pickHead, petalWeightTotal };
}


function createParticleData() {
  const positions = new Float32Array(PARTICLE_COUNT * 4);
  const attributes = new Float32Array(PARTICLE_COUNT * 4);
  const { heads, petals, pickHead, petalWeightTotal } = buildRosePetals();
  const pickPetal = () => {
    let value = Math.random() * petalWeightTotal;
    for (const petal of petals) {
      value -= petal.weight;
      if (value <= 0) return petal;
    }
    return petals[petals.length - 1];
  };

  const put = (index, position, color, size, seed) => {
    const offset = index * 4;
    positions[offset] = position[0];
    positions[offset + 1] = position[1];
    positions[offset + 2] = position[2];
    positions[offset + 3] = seed;
    attributes[offset] = color[0];
    attributes[offset + 1] = color[1];
    attributes[offset + 2] = color[2];
    attributes[offset + 3] = size;
  };

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    const category = Math.random();
    const seed = Math.random() * 1000;

    if (category < 0.42) {
      // Rose petals, sampled from overlapping 3D surfaces.
      const petal = pickPetal();
      const head = petal.head;
      const t = Math.random();
      const v =
        Math.random() < 0.23
          ? (Math.random() < 0.5 ? -1 : 1)
          : randomBetween(-0.97, 0.97);
      const local = samplePetal(petal, t, v);
      const normal = petalNormal(petal, t, v);
      const cosTilt = Math.cos(petal.head.tilt);
      const sinTilt = Math.sin(petal.head.tilt);
      const tiltedY = local[1] * cosTilt - local[2] * sinTilt;
      const tiltedZ = local[1] * sinTilt + local[2] * cosTilt;
      const tiltedNormalY = normal[1] * cosTilt - normal[2] * sinTilt;
      const tiltedNormalZ = normal[1] * sinTilt + normal[2] * cosTilt;
      const lambert = Math.max(
        0,
        normal[0] * LIGHT_DIRECTION[0] +
          tiltedNormalY * LIGHT_DIRECTION[1] +
          tiltedNormalZ * LIGHT_DIRECTION[2],
      );
      const fluff = Math.random() < 0.22;
      const jitter = fluff ? randomBetween(0.035, 0.13) : randomBetween(0.008, 0.04);
      const position = [
        petal.head.x +
          local[0] * petal.head.scale +
          normal[0] * jitter +
          randomBetween(-0.018, 0.018),
        petal.head.y +
          tiltedY * petal.head.scale +
          tiltedNormalY * jitter +
          randomBetween(-0.018, 0.018),
        petal.head.z +
          tiltedZ * petal.head.scale +
          tiltedNormalZ * jitter +
          randomBetween(-0.018, 0.018),
      ];

      // Colour follows petal structure instead of random per-particle noise.
      // Inner layers are deeper red, outer layers pink, rims fade to cream.
      let color = mixColor(ROSE_RED, PINK, 0.58 + petal.layer * 0.35);
      if (petal.layer < 0.35 && Math.random() < 0.48) {
        color = mixColor(color, ROSE_RED, randomBetween(0.18, 0.48));
      }
      if (Math.abs(v) > 0.68) {
        color = mixColor(color, PALE, randomBetween(0.24, 0.62));
      }
      const lighting = 0.58 + lambert * 0.42;
      color = [
        color[0] * lighting,
        color[1] * lighting,
        color[2] * lighting,
      ];
      const size =
        (fluff ? randomBetween(0.55, 1.45) : randomBetween(0.65, 1.75)) *
        (1.0 + petal.layer * 0.22);
      put(index, position, color, size, seed);
      continue;
    }

    if (category < 0.68) {
      // Volumetric flower fog bridges the individual petal shells.
      const head = pickHead();
      const angle = Math.random() * TAU;
      const volumeRadius = head.scale * 0.58;
      const radial =
        Math.sqrt(Math.random()) * volumeRadius *
        (0.90 + 0.10 * Math.sin(angle * 5.0 + seed));
      const radialFraction = Math.min(1, radial / volumeRadius);
      const position = [
        head.x + Math.cos(angle) * radial,
        head.y + Math.sin(angle) * radial,
        head.z +
          randomBetween(0.02, 0.92) * head.scale +
          randomBetween(-0.025, 0.025),
      ];

      let color = mixColor(
        ROSE_RED,
        PINK,
        0.48 + Math.min(1, radialFraction) * 0.38,
      );
      if (radialFraction < 0.34 && Math.random() < 0.42) {
        color = mixColor(color, ROSE_RED, 0.24);
      }
      color = mixColor(color, PALE, Math.max(0, radialFraction - 0.62) * 0.42);
      put(index, position, color, randomBetween(0.72, 1.86), seed);
      continue;
    }

    if (category < 0.92) {
      // Layered petals continue down from the flower to the ribbon.
      const head = pickHead();
      const t = Math.random();
      const angle =
        head.rotation + Math.floor(Math.random() * 20) * (TAU / 20);
      const centerX = head.x * (1.0 - 0.80 * t);
      const centerY = head.y * (1.0 - 0.80 * t);
      const centerZ =
        head.z - 0.02 + (0.19 - (head.z - 0.02)) * t;
      let position;
      let globalFill = false;

      if (Math.random() < 0.62) {
        // A shared lower cloud fills the gap between all seven flower heads.
        globalFill = true;
        const fillAngle = Math.random() * TAU;
        const fillRadius =
          Math.sqrt(Math.random()) *
          (0.78 * (1.0 - t) + 0.25) *
          (0.84 + 0.16 * Math.sin(fillAngle * 7.0 + seed));
        position = [
          Math.cos(fillAngle) * fillRadius,
          Math.sin(fillAngle) * fillRadius * 0.74,
          0.74 + (0.18 - 0.74) * t + randomBetween(-0.025, 0.025),
        ];
      } else if (Math.random() < 0.56) {
        // Fill the interior cone, not only its outer petal sheets.
        const fillAngle = Math.random() * TAU;
        const radial =
          Math.sqrt(Math.random()) *
          head.scale *
          (0.18 * (1.0 - t) + 0.045);
        position = [
          centerX + Math.cos(fillAngle) * radial,
          centerY + Math.sin(fillAngle) * radial,
          centerZ + randomBetween(-0.024, 0.024),
        ];
      } else {
        const radial =
          head.scale * 0.12 * Math.pow(1.0 - t, 0.72) + 0.012;
        const halfWidth =
          head.scale *
          (0.062 + 0.072 * Math.sin(Math.PI * t)) *
          (1.0 - 0.38 * t);
        const lateral = randomBetween(-1.0, 1.0) * halfWidth;
        position = [
          centerX + Math.cos(angle) * radial - Math.sin(angle) * lateral,
          centerY + Math.sin(angle) * radial + Math.cos(angle) * lateral,
          centerZ + Math.sin(Math.PI * t) * 0.016,
        ];
      }

      let color;
      if (globalFill) {
        color =
          Math.random() < 0.62
            ? mixColor(WHITE, PINK, randomBetween(0.20, 0.62))
            : Math.random() < 0.68
              ? PINK
              : ROSE_RED;
        color = color.map((channel) => channel * 1.42);
      } else {
        color = Math.random() < 0.70 ? PINK : ROSE_RED;
        color = mixColor(color, PALE, randomBetween(0.12, 0.46));
      }
      put(index, position, color, randomBetween(0.82, 2.05), seed);
      continue;
    }

    if (category < 0.95) {
      // Seven leaf-free stems.
      const head = pickHead();
      const t = Math.random();
      let center;
      if (t < 0.42) {
        const along = t / 0.42;
        center = [
          head.x * 0.72 * (1.0 - along),
          head.y * 0.72 * (1.0 - along),
          head.z * (1.0 - along) + 0.19 * along,
        ];
      } else {
        const along = (t - 0.42) / 0.58;
        center = [
          Math.cos(head.rotation + 0.45) * 0.10 * along,
          Math.sin(head.rotation + 0.45) * 0.075 * along,
          0.19 * (1.0 - along) - 0.52 * along,
        ];
      }
      const angle = Math.random() * TAU;
      const radius = randomBetween(0.005, 0.027);
      const color = mixColor(STEM, [0.55, 0.70, 0.55], Math.random() * 0.46);
      put(
        index,
        [
          center[0] + Math.cos(angle) * radius,
          center[1] + Math.sin(angle) * radius,
          center[2],
        ],
        color,
        randomBetween(0.45, 1.15),
        seed,
      );
      continue;
    }

    if (category < 0.985) {
      // White ribbon and bow at the gathering point.
      const angle = Math.random() * TAU;
      const radius = randomBetween(0.245, 0.285);
      let position;
      if (Math.random() < 0.72) {
        position = [
          Math.cos(angle) * radius,
          Math.sin(angle) * radius * 0.90,
          randomBetween(-0.11, 0.10),
        ];
      } else {
        const side = Math.random() < 0.5 ? -1 : 1;
        position = [
          side * 0.16 + Math.cos(angle) * 0.17,
          -0.29 + Math.sin(angle) * 0.055,
          randomBetween(0.08, 0.29),
        ];
      }
      put(
        index,
        position,
        mixColor(WHITE, PALE, Math.random() * 0.20),
        randomBetween(0.55, 1.45),
        seed,
      );
      continue;
    }

    // Pale-blue bag, widest at the opening and narrow at the bottom.
    const t = Math.random();
    const angle = Math.random() * TAU;
    const pleat = 1.0 + 0.055 * Math.sin(angle * 9.0 + t * 2.4);
    const radius = (1.02 - 0.74 * Math.pow(t, 0.88)) * pleat;
    const position = [
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.72,
      0.86 - 0.56 * t,
    ];
    put(
      index,
      position,
      mixColor(BLUE, [0.75, 0.92, 1.0], Math.random() * 0.45),
      randomBetween(0.38, 1.08),
      seed,
    );
  }

  return { positions, attributes };
}


async function createReferenceParticleData() {
  const image = new Image();
  image.src = "./bouquet_reference.webp";
  await image.decode();

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  sourceContext.drawImage(image, 0, 0);
  const source = sourceContext.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  ).data;

  const pixelCount = sourceCanvas.width * sourceCanvas.height;
  const cumulative = new Float64Array(pixelCount);
  let totalWeight = 0;

  for (let y = 0; y < sourceCanvas.height; y += 1) {
    for (let x = 0; x < sourceCanvas.width; x += 1) {
      const pixelIndex = y * sourceCanvas.width + x;
      const offset = pixelIndex * 4;
      const red = source[offset];
      const green = source[offset + 1];
      const blue = source[offset + 2];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);

      let weight = Math.pow(Math.max(0, luminance - 4) / 255, 0.78);
      if (saturation < 7 && luminance > 82) weight *= 0.14;
      if (x < 23 && y > 340 && y < 510) weight = 0;
      if (x > 690) weight *= 0.18;

      totalWeight += weight;
      cumulative[pixelIndex] = totalWeight;
    }
  }

  const positions = new Float32Array(PARTICLE_COUNT * 4);
  const attributes = new Float32Array(PARTICLE_COUNT * 4);
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const modelHeight = 2.55 * (height / width);

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    const coreFill = Math.random() < 0.22;
    let x;
    let y;

    if (coreFill) {
      const gaussianA = Math.max(0.001, Math.random());
      const gaussianB = Math.random() * TAU;
      const radius = Math.sqrt(-2.0 * Math.log(gaussianA));
      x = Math.max(
        0,
        Math.min(width - 1, width * (0.5 + Math.cos(gaussianB) * radius * 0.075)),
      );
      y = Math.max(
        0,
        Math.min(height - 1, height * (0.45 + Math.sin(gaussianB) * radius * 0.10)),
      );
    } else {
      const selection = Math.random() * totalWeight;
      let low = 0;
      let high = pixelCount - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (cumulative[middle] < selection) low = middle + 1;
        else high = middle;
      }
      x = low % width;
      y = Math.floor(low / width);
    }

    x = Math.round(x);
    y = Math.round(y);
    const pixelIndex = y * width + x;
    const offset = pixelIndex * 4;
    const red = source[offset] / 255;
    const green = source[offset + 1] / 255;
    const blue = source[offset + 2] / 255;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;

    const normalizedX = (x + Math.random() - 0.5) / width - 0.5;
    const normalizedY = (y + Math.random() - 0.5) / height - 0.5;
    const depth =
      (Math.random() - 0.5) *
      (0.34 + (1.0 - Math.min(1, luminance)) * 0.32);

    const dataOffset = index * 4;
    positions[dataOffset] = normalizedX * 2.55;
    positions[dataOffset + 1] = depth;
    positions[dataOffset + 2] = -normalizedY * modelHeight;
    positions[dataOffset + 3] = Math.random() * 1000;

    const colorLift = 1.18 + Math.random() * 0.42;
    let particleColor = [red, green, blue];
    const imageY = y / height;
    const imageX = x / width;
    let blueAccent = false;
    if (
      imageY > 0.39 &&
      imageY < 0.64 &&
      Math.abs(imageX - 0.5) > 0.10 &&
      Math.random() < 0.34
    ) {
      blueAccent = true;
      particleColor = mixColor(
        particleColor,
        [0.50, 0.68, 0.76],
        randomBetween(0.16, 0.27),
      );
    } else if (
      imageY > 0.38 &&
      imageY < 0.68 &&
      Math.abs(imageX - 0.5) <= 0.10
    ) {
      particleColor = mixColor(particleColor, PALE, 0.12);
    }
    if (coreFill) {
      const tone = Math.random();
      particleColor =
        tone < 0.14
          ? mixColor(WHITE, PINK, randomBetween(0.55, 0.82))
          : tone < 0.84
            ? PINK
            : tone < 0.96
              ? mixColor(PINK, ROSE_RED, 0.35)
              : ROSE_RED;
      if (Math.random() < 0.25) {
        particleColor = mixColor(
          particleColor,
          ROSE_RED,
          randomBetween(0.34, 0.58),
        );
      }
    } else if (imageY < 0.43 && Math.random() < 0.46) {
      particleColor = mixColor(
        particleColor,
        ROSE_RED,
        randomBetween(0.40, 0.64),
      );
    }
    const centerDim = coreFill ? 0.72 : 1.0;
    const topEmphasis = !coreFill && imageY < 0.40 ? 1.12 : 1.0;
    attributes[dataOffset] = particleColor[0] * colorLift * centerDim * topEmphasis;
    attributes[dataOffset + 1] = particleColor[1] * colorLift * centerDim * topEmphasis;
    attributes[dataOffset + 2] = particleColor[2] * colorLift * centerDim * topEmphasis;
    attributes[dataOffset + 3] =
      randomBetween(0.62, 1.72) *
      (0.78 + luminance * 0.38) *
      (blueAccent ? 0.72 : 1.0) *
      (coreFill ? 0.92 : topEmphasis);
  }

  return { positions, attributes };
}


function createSimulation(renderer, data) {
  const gpu = new GPUComputationRenderer(TEXTURE_SIZE, TEXTURE_SIZE, renderer);
  const positionTexture = gpu.createTexture();
  const velocityTexture = gpu.createTexture();
  positionTexture.image.data.set(data.positions);
  velocityTexture.image.data.fill(0);

  const targetTexture = new THREE.DataTexture(
    data.positions,
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  targetTexture.minFilter = THREE.NearestFilter;
  targetTexture.magFilter = THREE.NearestFilter;
  targetTexture.needsUpdate = true;

  const attributeTexture = new THREE.DataTexture(
    data.attributes,
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  attributeTexture.minFilter = THREE.NearestFilter;
  attributeTexture.magFilter = THREE.NearestFilter;
  attributeTexture.needsUpdate = true;

  const velocityShader = `
    uniform float uTime;
    uniform float uDelta;
    uniform sampler2D uTargets;

    void main() {
      vec2 vUv = gl_FragCoord.xy / resolution.xy;
      vec3 position = texture2D(texturePosition, vUv).xyz;
      vec4 target = texture2D(uTargets, vUv);
      vec3 velocity = texture2D(textureVelocity, vUv).xyz;
      vec3 towardTarget = target.xyz - position;
      float seed = target.w;

      vec3 breathing = vec3(
        sin(seed * 2.13 + uTime * 0.74),
        cos(seed * 1.71 + uTime * 0.63),
        sin(seed * 2.91 + uTime * 0.51)
      );
      vec3 swirl = vec3(-position.y, position.x, 0.0) * 0.045;

      velocity += towardTarget * 4.10 * uDelta;
      velocity += (breathing * 0.008 + swirl * 0.20) * uDelta;
      velocity *= exp(-2.85 * uDelta);

      float speed = length(velocity);
      if (speed > 0.075) {
        velocity = velocity / speed * 0.075;
      }

      gl_FragColor = vec4(velocity, 0.0);
    }
  `;

  const positionShader = `
    uniform float uDelta;

    void main() {
      vec2 vUv = gl_FragCoord.xy / resolution.xy;
      vec4 state = texture2D(texturePosition, vUv);
      vec3 velocity = texture2D(textureVelocity, vUv).xyz;
      state.xyz += velocity * uDelta;
      gl_FragColor = state;
    }
  `;

  const velocityVariable = gpu.addVariable(
    "textureVelocity",
    velocityShader,
    velocityTexture,
  );
  const positionVariable = gpu.addVariable(
    "texturePosition",
    positionShader,
    positionTexture,
  );

  gpu.setVariableDependencies(velocityVariable, [
    velocityVariable,
    positionVariable,
  ]);
  gpu.setVariableDependencies(positionVariable, [
    velocityVariable,
    positionVariable,
  ]);

  for (const variable of [velocityVariable, positionVariable]) {
    variable.wrapS = THREE.ClampToEdgeWrapping;
    variable.wrapT = THREE.ClampToEdgeWrapping;
    variable.minFilter = THREE.NearestFilter;
    variable.magFilter = THREE.NearestFilter;
  }

  velocityVariable.material.uniforms.uTime = { value: 0.0 };
  velocityVariable.material.uniforms.uDelta = { value: 0.0 };
  velocityVariable.material.uniforms.uTargets = { value: targetTexture };
  positionVariable.material.uniforms.uDelta = { value: 0.0 };

  const error = gpu.init();
  if (error) {
    throw new Error(error);
  }

  return {
    gpu,
    velocityVariable,
    positionVariable,
    attributeTexture,
  };
}


function createParticleMaterial(simulation) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uPositions: { value: null },
      uAttributes: { value: simulation.attributeTexture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uScale: { value: 300.0 },
      uYaw: { value: 0.3 },
      uPitch: { value: 0.13 },
      uModelCenterZ: { value: MODEL_CENTER_Z },
      uPixelRatio: { value: 1.0 },
      uPointScale: { value: 1.0 },
      uAlphaScale: { value: COMPACT_VIEW ? 0.105 : 0.20 },
      uTime: { value: 0.0 },
    },
    vertexShader: `
      precision highp float;
      precision highp int;

      uniform sampler2D uPositions;
      uniform sampler2D uAttributes;
      uniform vec2 uResolution;
      uniform vec2 uCenter;
      uniform float uScale;
      uniform float uYaw;
      uniform float uPitch;
      uniform float uModelCenterZ;
      uniform float uPixelRatio;
      uniform float uPointScale;
      uniform float uAlphaScale;
      uniform float uTime;

      out vec3 vColor;
      out float vAlpha;

      void main() {
        int textureSize = ${TEXTURE_SIZE};
        int x = gl_VertexID % textureSize;
        int y = gl_VertexID / textureSize;
        vec2 uv = (vec2(float(x), float(y)) + 0.5) / float(textureSize);

        vec4 state = texture(uPositions, uv);
        vec4 attributes = texture(uAttributes, uv);
        vec3 p = state.xyz;
        p.z -= uModelCenterZ;

        float cosYaw = cos(uYaw);
        float sinYaw = sin(uYaw);
        vec3 rotated = vec3(
          p.x * cosYaw - p.y * sinYaw,
          p.x * sinYaw + p.y * cosYaw,
          p.z
        );

        float cosPitch = cos(uPitch);
        float sinPitch = sin(uPitch);
        float vertical = rotated.z * cosPitch - rotated.y * sinPitch;
        float depth = rotated.y * cosPitch + rotated.z * sinPitch;
        float perspective = 1.0 / (1.0 + depth * 0.085);

        vec2 screen = uCenter + vec2(rotated.x, -vertical) * uScale * perspective;
        vec2 clip = vec2(
          screen.x / uResolution.x * 2.0 - 1.0,
          1.0 - screen.y / uResolution.y * 2.0
        );
        gl_Position = vec4(clip, 0.0, 1.0);

        float size = attributes.a * uPixelRatio * perspective;
        gl_PointSize = size * 1.8 * uPointScale;

        float flicker = 0.82 + 0.18 * sin(state.w * 5.73 + uTime * 0.85);
        vColor = attributes.rgb * mix(0.68, 1.0, clamp(perspective, 0.65, 1.25));
        vAlpha = flicker * uAlphaScale;
      }
    `,
    fragmentShader: `
      precision highp float;
      in vec3 vColor;
      in float vAlpha;
      layout(location = 0) out vec4 fragColor;

      void main() {
        vec2 centered = gl_PointCoord * 2.0 - 1.0;
        float radius = dot(centered, centered);
        if (radius > 1.0) discard;
        float softEdge = pow(max(0.0, 1.0 - radius), 1.65);
        fragColor = vec4(vColor * (0.85 + softEdge * 0.35), softEdge * vAlpha);
      }
    `,
  });
}


function createCube() {
  const half = 1.45;
  const centerZ = 0.0;
  const vertices = [];
  for (const x of [-half, half]) {
    for (const y of [-half, half]) {
      for (const z of [-half, half]) {
        vertices.push(x, y, z + centerZ);
      }
    }
  }

  const edges = [
    [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3],
    [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
  ];
  const positions = [];
  for (const [first, second] of edges) {
    for (const vertexIndex of [first, second]) {
      const offset = vertexIndex * 3;
      positions.push(
        vertices[offset],
        vertices[offset + 1],
        vertices[offset + 2],
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uScale: { value: 300.0 },
      uModelCenterZ: { value: MODEL_CENTER_Z },
      uYaw: { value: 0.0 },
      uPitch: { value: CUBE_PITCH },
    },
    vertexShader: `
      uniform vec2 uResolution;
      uniform vec2 uCenter;
      uniform float uScale;
      uniform float uModelCenterZ;
      uniform float uYaw;
      uniform float uPitch;

      out float vDepth;

      void main() {
        vec3 p = position;
        p.z -= uModelCenterZ;
        float cosYaw = cos(uYaw);
        float sinYaw = sin(uYaw);
        vec3 yawed = vec3(
          p.x * cosYaw - p.y * sinYaw,
          p.x * sinYaw + p.y * cosYaw,
          p.z
        );
        float cosine = cos(uPitch);
        float sine = sin(uPitch);
        float rotatedY = yawed.y * cosine + yawed.z * sine;
        float rotatedZ = -yawed.y * sine + yawed.z * cosine;
        float perspective = 1.0 / (1.0 + rotatedY * 0.022);
        vec2 screen = uCenter + vec2(yawed.x, -rotatedZ) * uScale * perspective;
        gl_Position = vec4(
          screen.x / uResolution.x * 2.0 - 1.0,
          1.0 - screen.y / uResolution.y * 2.0,
          0.0,
          1.0
        );
        vDepth = perspective;
      }
    `,
    fragmentShader: `
      precision highp float;
      in float vDepth;
      layout(location = 0) out vec4 fragColor;

      void main() {
        float alpha = mix(0.26, 0.68, clamp((vDepth - 0.85) / 0.30, 0.0, 1.0));
        fragColor = vec4(0.88, 0.72, 0.78, alpha);
      }
    `,
  });

  return new THREE.LineSegments(geometry, material);
}


function createPostProcessor(renderer) {
  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);

  const blurMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tScene: { value: null },
      uDirection: { value: new THREE.Vector2(1, 0) },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uApplyThreshold: { value: 1.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tScene;
      uniform vec2 uDirection;
      uniform vec2 uTexelSize;
      uniform float uApplyThreshold;
      varying vec2 vUv;

      void main() {
        float weights[5] = float[5](0.2270, 0.1945, 0.1216, 0.0540, 0.0162);
        vec3 result = vec3(0.0);
        for (int i = -4; i <= 4; i++) {
          vec2 offset = uDirection * uTexelSize * float(i) * 1.55;
          vec3 sampleColor = texture2D(tScene, vUv + offset).rgb;
          float luminance = max(sampleColor.r, max(sampleColor.g, sampleColor.b));
          float threshold = mix(1.0, smoothstep(0.22, 0.82, luminance), uApplyThreshold);
          result += sampleColor * threshold * weights[abs(i)];
        }
        gl_FragColor = vec4(result, 1.0);
      }
    `,
  });

  const compositeMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tScene: { value: null },
      tBloom: { value: null },
      tFog: { value: null },
      uAspect: { value: 1.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tScene;
      uniform sampler2D tBloom;
      uniform sampler2D tFog;
      uniform float uAspect;
      varying vec2 vUv;

      void main() {
        vec3 sceneColor = texture2D(tScene, vUv).rgb;
        vec3 bloomColor = texture2D(tBloom, vUv).rgb;
        vec3 fogColor = texture2D(tFog, vUv).rgb;
        vec2 p = vUv - vec2(0.50, 0.50);
        p.x *= uAspect;
        float halo = exp(-dot(p, p) * 2.4);
        vec3 background = vec3(0.0025, 0.0035, 0.009) + vec3(0.020, 0.006, 0.014) * halo;
        vec3 color =
          background +
          sceneColor * (${COMPACT_VIEW ? "0.86" : "0.98"}) +
          fogColor * (${COMPACT_VIEW ? "0.28" : "0.52"}) +
          bloomColor * (${COMPACT_VIEW ? "0.72" : "1.38"});
        color = vec3(1.0) - exp(-color * 1.18);
        color *= ${COMPACT_VIEW ? "0.70" : "1.0"};
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luminance), color, ${COMPACT_VIEW ? "0.88" : "1.0"});
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  const quad = new THREE.Mesh(geometry, blurMaterial);
  quad.frustumCulled = false;
  postScene.add(quad);

  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const bloomA = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const bloomB = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const fogA = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const fogB = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });

  for (const target of [sceneTarget, bloomA, bloomB, fogA, fogB]) {
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
  }

  const renderPass = (material, target) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(postScene, postCamera);
  };

  const resize = (width, height) => {
    sceneTarget.setSize(width, height);
    const bloomWidth = Math.max(1, Math.floor(width / 4));
    const bloomHeight = Math.max(1, Math.floor(height / 4));
    bloomA.setSize(bloomWidth, bloomHeight);
    bloomB.setSize(bloomWidth, bloomHeight);
    fogA.setSize(bloomWidth, bloomHeight);
    fogB.setSize(bloomWidth, bloomHeight);
    blurMaterial.uniforms.uTexelSize.value.set(1 / bloomWidth, 1 / bloomHeight);
    compositeMaterial.uniforms.uAspect.value = width / height;
  };

  const render = () => {
    blurMaterial.uniforms.tScene.value = sceneTarget.texture;
    blurMaterial.uniforms.uDirection.value.set(1, 0);
    blurMaterial.uniforms.uApplyThreshold.value = 1.0;
    renderPass(blurMaterial, bloomA);

    blurMaterial.uniforms.tScene.value = bloomA.texture;
    blurMaterial.uniforms.uDirection.value.set(0, 1);
    blurMaterial.uniforms.uApplyThreshold.value = 0.0;
    renderPass(blurMaterial, bloomB);

    blurMaterial.uniforms.tScene.value = sceneTarget.texture;
    blurMaterial.uniforms.uDirection.value.set(1, 0);
    blurMaterial.uniforms.uApplyThreshold.value = 0.0;
    renderPass(blurMaterial, fogA);

    blurMaterial.uniforms.tScene.value = fogA.texture;
    blurMaterial.uniforms.uDirection.value.set(0, 1);
    blurMaterial.uniforms.uApplyThreshold.value = 0.0;
    renderPass(blurMaterial, fogB);

    compositeMaterial.uniforms.tScene.value = sceneTarget.texture;
    compositeMaterial.uniforms.tBloom.value = bloomB.texture;
    compositeMaterial.uniforms.tFog.value = fogB.texture;
    renderPass(compositeMaterial, null);
  };

  return { sceneTarget, resize, render };
}


function startBlessingRain() {
  const layer = document.getElementById("blessing-layer");
  if (!layer) return;

  const blessings = [
    "张卫敏女士，祝您生日快乐",
    "身体健康，岁岁平安",
    "日进斗金，万事顺遂",
    "爱你老妈，永远年轻",
    "愿您笑口常开，喜乐常在",
    "岁岁常欢愉，年年皆胜意",
    "福寿安康，诸事顺心",
    "愿所行皆坦途，所愿皆成真",
    "花常开，人常健，家常暖",
    "妈妈，生日快乐，我们爱您",
    "愿每一天都有好心情",
    "平安喜乐，万事胜意",
    "岁月温柔，好运常伴",
    "愿您眼里有光，心中有暖",
    "生日快乐，幸福久久",
    "愿生活有滋有味，日子有盼有甜",
    "愿您事事如意",
    "愿健康常伴左右",
    "愿快乐与您相随",
    "愿此后皆是好时光",
    "家和万事兴",
    "愿您心宽福自来",
    "愿生活温柔有趣",
    "愿所盼皆如愿",
  ];
  let nextIndex = 0;

  const spawn = (initial = false) => {
    const text = blessings[nextIndex % blessings.length];
    nextIndex += 1;

    const line = document.createElement("span");
    line.className = "blessing";
    line.textContent = text;

    const leftSide = nextIndex % 2 === 0;
    const laneCount = COMPACT_VIEW ? 1 : 2;
    const lane = Math.floor(nextIndex / 2) % laneCount;
    const inset = 2.5 + lane * 5.0 + randomBetween(0, 1.2);
    const duration = randomBetween(15.0, 21.0);
    const delay = initial ? -randomBetween(0, duration * 0.82) : randomBetween(0, 0.5);

    if (leftSide) {
      line.style.left = `${inset}vw`;
      line.style.textAlign = "left";
    } else {
      line.style.right = `${inset}vw`;
      line.style.textAlign = "right";
    }
    const fontSize = COMPACT_VIEW
      ? randomBetween(11, 15)
      : randomBetween(14, 19);
    line.style.setProperty("--font-size", `${fontSize.toFixed(1)}px`);
    line.style.setProperty("--opacity", randomBetween(0.42, 0.76).toFixed(2));
    line.style.setProperty(
      "--text-color",
      Math.random() < 0.30
        ? "rgba(255, 219, 174, 0.72)"
        : "rgba(255, 224, 232, 0.72)",
    );
    line.style.setProperty("--drift", `${randomBetween(-26, 26).toFixed(1)}px`);
    line.style.setProperty("--duration", `${duration.toFixed(2)}s`);
    line.style.animationDelay = `${delay.toFixed(2)}s`;
    line.addEventListener("animationend", () => line.remove(), { once: true });
    layer.appendChild(line);
  };

  for (let index = 0; index < 10; index += 1) {
    spawn(true);
  }
  window.setInterval(() => spawn(false), COMPACT_VIEW ? 1400 : 1000);
}


async function start() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch (error) {
    showError(`无法创建 WebGL2 渲染器。\n${error.message}`);
    return;
  }

  if (!renderer.capabilities.isWebGL2) {
    showError("当前浏览器不支持 WebGL2，请使用最新版 Edge 或 Chrome。");
    return;
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x010205, 1);

  let data;
  try {
    data = await createReferenceParticleData();
  } catch (error) {
    console.warn("Reference particle map unavailable; using procedural fallback.", error);
    data = createParticleData();
  }
  const simulation = createSimulation(renderer, data);
  const material = createParticleMaterial(simulation);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3),
  );
  const particles = new THREE.Points(geometry, material);
  particles.frustumCulled = false;

  const cube = createCube();
  const scene = new THREE.Scene();
  scene.add(cube);
  scene.add(particles);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const post = createPostProcessor(renderer);

  const state = {
    cubeYaw: 0.12,
    cubePitch: CUBE_PITCH,
    zoom: 1.0,
    dragging: false,
    previousX: 0,
    previousY: 0,
    width: 1,
    height: 1,
    pixelRatio: 1,
  };

  const resize = () => {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      COMPACT_VIEW ? 1.25 : 1.6,
    );
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    const centerY =
      buffer.y * 0.50 + SCENE_DOWN_CM * CSS_PIXELS_PER_CM * pixelRatio;
    state.width = buffer.x;
    state.height = buffer.y;
    state.pixelRatio = pixelRatio;

    material.uniforms.uResolution.value.set(buffer.x, buffer.y);
    material.uniforms.uCenter.value.set(buffer.x * 0.50, centerY);
    material.uniforms.uPixelRatio.value = pixelRatio;
    cube.material.uniforms.uResolution.value.set(buffer.x, buffer.y);
    cube.material.uniforms.uCenter.value.set(buffer.x * 0.50, centerY);
    post.resize(buffer.x, buffer.y);
  };

  canvas.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.previousX = event.clientX;
    state.previousY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    state.cubeYaw += (event.clientX - state.previousX) * 0.008;
    state.cubePitch += (event.clientY - state.previousY) * 0.006;
    state.previousX = event.clientX;
    state.previousY = event.clientY;
  });
  canvas.addEventListener("pointerup", (event) => {
    state.dragging = false;
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      state.zoom = Math.max(0.72, Math.min(1.55, state.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    },
    { passive: false },
  );
  window.addEventListener("keydown", async (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    try {
      await fetch("/shutdown", { method: "POST" });
    } catch (_) {
      // Direct file mode cannot terminate the browser, but still closes if permitted.
    }
    window.close();
  });
  window.addEventListener("resize", resize);

  resize();
  let previousTime = performance.now();

  const animate = (now) => {
    const delta = Math.min((now - previousTime) / 1000, 0.033);
    previousTime = now;

    if (!state.dragging) {
      state.cubeYaw += delta * CUBE_ROTATION_SPEED;
    }

    const simulationDelta = Math.max(delta, 1 / 120);
    simulation.velocityVariable.material.uniforms.uTime.value = now / 1000;
    simulation.velocityVariable.material.uniforms.uDelta.value = simulationDelta;
    simulation.positionVariable.material.uniforms.uDelta.value = simulationDelta;
    simulation.gpu.compute();

    material.uniforms.uPositions.value =
      simulation.gpu.getCurrentRenderTarget(simulation.positionVariable).texture;
    material.uniforms.uYaw.value = 0.0;
    material.uniforms.uPitch.value = 0.01;
    material.uniforms.uTime.value = now / 1000;
    const responsiveScale = Math.min(state.width, state.height) *
      (COMPACT_VIEW ? 0.235 : 0.275) *
      state.zoom;
    material.uniforms.uScale.value = responsiveScale;
    cube.material.uniforms.uScale.value =
      responsiveScale * 0.99;
    cube.material.uniforms.uYaw.value = state.cubeYaw;
    cube.material.uniforms.uPitch.value = state.cubePitch;

    renderer.setRenderTarget(post.sceneTarget);
    renderer.setClearColor(0x010205, 1);
    renderer.clear();

    material.uniforms.uPointScale.value = COMPACT_VIEW ? 8.0 : 12.0;
    material.uniforms.uAlphaScale.value = COMPACT_VIEW ? 0.0045 : 0.008;
    renderer.render(scene, camera);
    material.uniforms.uPointScale.value = COMPACT_VIEW ? 3.0 : 4.2;
    material.uniforms.uAlphaScale.value = COMPACT_VIEW ? 0.015 : 0.028;
    renderer.render(scene, camera);
    material.uniforms.uPointScale.value = 1.0;
    material.uniforms.uAlphaScale.value = COMPACT_VIEW ? 0.105 : 0.20;
    renderer.render(scene, camera);
    post.render();

    requestAnimationFrame(animate);
  };

  requestAnimationFrame(animate);
  startBlessingRain();
}


start().catch((error) => {
  console.error(error);
  showError(`GPU 粒子初始化失败。\n${error.message}`);
});
