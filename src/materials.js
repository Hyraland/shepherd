import * as THREE from 'three';
import { NOISE, CLOUD } from './shaders.js';
import { noiseTexture } from './noiseTexture.js';
import { cloudUniform } from './config.js';

// 给 three 自带的 PBR 材质（写实模式下的羊）补上和草地一致的云影：
// 云飘过时直射光（漫反射 + 高光）被遮住，只剩天光。
export const cloudUniforms = {
  uTime: { value: 0 },
  uNoise: { value: noiseTexture() },
  uSunView: { value: new THREE.Vector3(0, 1, 0) }, // 视空间里的太阳方向，每帧更新
  uRimColor: { value: new THREE.Color(1, 0.86, 0.6) },
};

export function withClouds(m) {
  if (m.userData.clouds) return m;
  m.userData.clouds = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uTime = cloudUniforms.uTime;
    sh.uniforms.uNoise = cloudUniforms.uNoise;
    sh.uniforms.uCloud = cloudUniform;
    sh.uniforms.uSunView = cloudUniforms.uSunView;
    sh.uniforms.uRimColor = cloudUniforms.uRimColor;
    sh.vertexShader = 'varying vec2 vCloudXZ;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
      {
        vec4 cwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cwp = instanceMatrix * cwp;
        #endif
        vCloudXZ = (modelMatrix * cwp).xz;
      }`
    );
    sh.fragmentShader =
      'uniform float uTime;\nuniform vec3 uSunView;\nuniform vec3 uRimColor;\nvarying vec2 vCloudXZ;\n' + NOISE + CLOUD +
      sh.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          float cloudCs = cloudShadow(vCloudXZ);
          reflectedLight.directDiffuse *= cloudCs;
          reflectedLight.directSpecular *= cloudCs;
          // 逆光时毛茸茸的边缘透出一圈暖光
          vec3 Vv = normalize(vViewPosition);
          float rim = pow(1.0 - max(dot(normal, Vv), 0.0), 2.5);
          float back = smoothstep(-0.2, 0.8, dot(uSunView, -Vv));
          reflectedLight.directDiffuse += uRimColor * diffuseColor.rgb * rim * (0.15 + 1.6 * back) * cloudCs;
        }`
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key() + '|clouds';
  m.needsUpdate = true;
  return m;
}

export const standard = (params) => withClouds(new THREE.MeshStandardMaterial(params));
export const physical = (params) => withClouds(new THREE.MeshPhysicalMaterial(params));
