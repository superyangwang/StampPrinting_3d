import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

function Stamp({ geometry }) {
  const ref = useRef();
  useEffect(() => {
    if (ref.current && geometry) {
      ref.current.geometry = geometry;
    }
  }, [geometry]);
  if (!geometry) return null;
  return (
    <mesh ref={ref} castShadow receiveShadow>
      <meshStandardMaterial color="#c9a373" roughness={0.7} metalness={0.05} />
    </mesh>
  );
}

export default function StampViewer({ geometry, placeholder }) {
  return (
    <div className="viewer">
      <Canvas
        shadows
        dpr={[1, 2]}
        onCreated={({ camera }) => {
          // Mesh uses Z-up (3D-printing convention). Tell three.js so the
          // OrbitControls and lighting behave intuitively.
          THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
          camera.up.set(0, 0, 1);
          camera.position.set(70, -90, 60);
          camera.lookAt(0, 0, 5);
        }}
        camera={{ fov: 35, near: 0.1, far: 1000 }}
      >
        <color attach="background" args={['#1b1d21']} />
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[40, -30, 80]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <directionalLight position={[-40, 30, 30]} intensity={0.3} />
        <Grid
          args={[200, 200]}
          cellSize={5}
          sectionSize={25}
          sectionColor="#444"
          cellColor="#2a2c30"
          infiniteGrid
          fadeDistance={250}
          position={[0, 0, -0.01]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
        <Stamp geometry={geometry} />
        <OrbitControls makeDefault target={[0, 0, 5]} />
      </Canvas>
      {!geometry && <div className="placeholder">{placeholder}</div>}
    </div>
  );
}
