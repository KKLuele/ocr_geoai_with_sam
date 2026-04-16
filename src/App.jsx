import React, { useState, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, useCursor } from '@react-three/drei';
import { Activity, Cuboid, Layers, Navigation, BoxSelect, Scissors, ZoomIn } from 'lucide-react';
import * as THREE from 'three';
import './index.css';

// Novo Controlador de Câmara para o Zoom com "Palma Aberta"
const CameraController = ({ handData }) => {
  const { camera } = useThree();
  useFrame(() => {
    // Se a palma estiver bem aberta, não estiver a agarrar e houver dados de tamanho
    if (handData.is_open_palm && !handData.is_grabbing && handData.hand_size) {
       // O hand_size costuma rondar 0.1 (longe) a 0.5 (perto do ecrã)
       // Mapearemos matematicamente para afastar/aproximar a câmara
       const targetZ = 20 - (handData.hand_size * 25);
       const clampedZ = Math.max(4, Math.min(30, targetZ)); // Limites min/max zoom
       
       // Lerp suave para não dar tonturas
       camera.position.lerp(new THREE.Vector3(camera.position.x, camera.position.y, clampedZ), 0.05);
    }
  });
  return null;
};

const GeoBlock = ({ position, rotationVec, color, isGrabbed, scale = [1, 1, 1] }) => {
  const meshRef = useRef();
  const [hovered, setHover] = useState(false);
  useCursor(hovered);

  useFrame((state) => {
    if (!meshRef.current) return;
    
    if (isGrabbed) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 10) * 0.05;
      meshRef.current.scale.lerp(new THREE.Vector3(scale[0]*s, scale[1]*s, scale[2]*s), 0.2);
      meshRef.current.position.lerp(new THREE.Vector3(...position), 0.3);
      
      // Aplicar a rotação 360 se tivermos vetor diretor do pulso válido (não nulo)
      if (rotationVec && (Math.abs(rotationVec.x) > 0.001 || Math.abs(rotationVec.y) > 0.001 || Math.abs(rotationVec.z) > 0.001)) {
         const targetPt = new THREE.Vector3(
             meshRef.current.position.x + rotationVec.x,
             meshRef.current.position.y - rotationVec.y, 
             meshRef.current.position.z + rotationVec.z
         );
         
         // Evita a singularidade do lookAt em Math 3D
         if (targetPt.distanceTo(meshRef.current.position) > 0.01) {
             const dummy = new THREE.Object3D();
             dummy.position.copy(meshRef.current.position);
             dummy.lookAt(targetPt);
             meshRef.current.quaternion.slerp(dummy.quaternion, 0.1);
         }
      }
    } else {
      meshRef.current.scale.lerp(new THREE.Vector3(...scale), 0.1);
      meshRef.current.position.lerp(new THREE.Vector3(...position), 0.3);
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={position}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1.5, 1.5, 1.5]} />
      <meshStandardMaterial 
        color={color} 
        roughness={0.4} 
        metalness={0.1}
        emissive={isGrabbed ? color : '#000000'}
        emissiveIntensity={isGrabbed ? 0.3 : 0}
      />
      {hovered && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(1.6, 1.6, 1.6)]} />
          <lineBasicMaterial color={isGrabbed ? "#ff00ea" : "#00e5ff"} linewidth={2} />
        </lineSegments>
      )}
    </mesh>
  );
};

const VirtualHand = ({ handData }) => {
  const meshRef = useRef();

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.lerp(
        new THREE.Vector3(handData.x, handData.y, handData.z),
        0.3
      );
      
      // Rodar o próprio cursor para imitar o pulso, protegendo de vetores nulos
      if (handData.dir_x !== undefined && (Math.abs(handData.dir_x) > 0.001 || Math.abs(handData.dir_y) > 0.001 || Math.abs(handData.dir_z) > 0.001)) {
          const targetPt = new THREE.Vector3(
             meshRef.current.position.x + handData.dir_x,
             meshRef.current.position.y - handData.dir_y,
             meshRef.current.position.z + handData.dir_z
          );
          
          if (targetPt.distanceTo(meshRef.current.position) > 0.01) {
              meshRef.current.lookAt(targetPt);
          }
      }
    }
  });

  return (
    <mesh ref={meshRef} position={[handData.x, handData.y, handData.z]}>
      {/* Usar um cone ou cilindro pontiagudo ajuda a ver a "direção" ou Rotação melhor que uma esfera! */}
      <coneGeometry args={[0.3, 1.2, 16]} />
      <meshStandardMaterial 
        color={handData.is_grabbing ? "#ff00ea" : (handData.is_open_palm ? "#00ff88" : "#00e5ff")} 
        emissive={handData.is_grabbing ? "#ff00ea" : (handData.is_open_palm ? "#00ff88" : "#00e5ff")}
        emissiveIntensity={0.8}
        wireframe
      />
      <pointLight color={handData.is_grabbing ? "#ff00ea" : "#00e5ff"} intensity={2} distance={5} />
    </mesh>
  );
};

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [handData, setHandData] = useState({ 
      x: 0, y: 5, z: 0, 
      is_grabbing: false, 
      is_open_palm: false,
      hand_size: 0,
      dir_x: 0, dir_y: 0, dir_z: 0 
  });
  const wsRef = useRef(null);
  
  const [blocks, setBlocks] = useState([
    { id: 'b1', position: [0, 0.75, 0], rotationVec: null, color: '#ffb703', type: 'Minério' },
    { id: 'b2', position: [3, 0.75, 2], rotationVec: null, color: '#fb8500', type: 'Minério' },
    { id: 'b3', position: [-3, 0.75, -2], rotationVec: null, color: '#3f37c9', type: 'Estéril' },
  ]);
  const [grabbedBlockId, setGrabbedBlockId] = useState(null);

  const currentGrabbedRef = useRef(null);

  useEffect(() => {
    let ws;
    const connect = () => {
      try {
        ws = new WebSocket('ws://localhost:8000/ws');
        wsRef.current = ws;
        
        ws.onopen = () => setIsConnected(true);
        ws.onclose = () => setIsConnected(false);
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          
          if (data.action === "SEGMENT_RESULT") {
             console.log("Segmentação concluída:", data.info);
             return;
          }
          
          const MAPPED_X = (data.x - 0.5) * -15; 
          const MAPPED_Y = -(data.y - 0.5) * 10 + 2; 
          const MAPPED_Z = (data.z) * 15; 
          
          const rotationVec = { x: data.dir_x || 0, y: data.dir_y || 0, z: data.dir_z || 0 };

          setHandData({ 
              x: MAPPED_X || 0, 
              y: MAPPED_Y || 0, 
              z: MAPPED_Z || 0, 
              is_grabbing: !!data.is_grabbing,
              is_open_palm: !!data.is_open_palm,
              hand_size: data.hand_size || 0,
              dir_x: data.dir_x || 0,
              dir_y: data.dir_y || 0,
              dir_z: data.dir_z || 0
          });
          
          if (data.is_grabbing) {
              if (currentGrabbedRef.current === null) {
                  setBlocks(prevBlocks => {
                      let closest = null;
                      let minDist = 3.0; // raio tolerante
                      prevBlocks.forEach(b => {
                          const dist = Math.sqrt(
                              Math.pow(b.position[0] - MAPPED_X, 2) +
                              Math.pow(b.position[1] - MAPPED_Y, 2) +
                              Math.pow(b.position[2] - MAPPED_Z, 2)
                          );
                          if (dist < minDist) {
                              minDist = dist;
                              closest = b.id;
                          }
                      });
                      if (closest) {
                          currentGrabbedRef.current = closest;
                          setGrabbedBlockId(closest);
                      }
                      return prevBlocks;
                  });
              }

              if (currentGrabbedRef.current !== null) {
                  setBlocks(prevBlocks => prevBlocks.map(b => 
                      b.id === currentGrabbedRef.current 
                          ? { ...b, position: [MAPPED_X, MAPPED_Y, MAPPED_Z], rotationVec: rotationVec } 
                          : b
                  ));
              }
          } else {
              if (currentGrabbedRef.current !== null) {
                  currentGrabbedRef.current = null;
                  setGrabbedBlockId(null);
                  
                  // Retirar o vetor rotação dinâmico quando larga, mantendo onde ficou
                  setBlocks(prevBlocks => prevBlocks.map(b => 
                      b.id === currentGrabbedRef.current 
                          ? { ...b, position: [MAPPED_X, 0.75, MAPPED_Z], rotationVec: null } 
                          : b
                  ));
              }
          }
        };
      } catch (e) {
        console.error("Connection failed", e);
      }
    };
    
    connect(); 
    return () => { if(ws) ws.close(); };
  }, []);

  const handleIsolateBlock = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: "SEGMENT_BLOCK",
        x: Math.abs(Math.floor(handData.x * 100)),
        y: Math.abs(Math.floor(handData.y * 100))
      }));
    }
  };

  return (
    <div id="app-container" style={{ width: '100%', height: '100%' }}>
      <Canvas shadows camera={{ position: [0, 8, 12], fov: 45 }}>
        <color attach="background" args={['#0f1115']} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} castShadow intensity={1} shadow-mapSize={[2048, 2048]} />
        <Environment preset="night" />
        
        <Grid infiniteGrid fadeDistance={40} sectionColor="#00e5ff" cellColor="#ffffff" cellThickness={0.5} opacity={0.2} />
        
        {blocks.map(block => (
          <GeoBlock 
            key={block.id} 
            id={block.id}
            position={block.position}
            rotationVec={block.rotationVec} 
            color={block.color} 
            isGrabbed={grabbedBlockId === block.id}
          />
        ))}

        <VirtualHand handData={handData} />
        
        {/* Adiciona o controlador invisível que lê a "Palma" e mete Zoom nas lentes da Câmera */}
        <CameraController handData={handData} />
        
        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
      </Canvas>

      <div className="hud-overlay">
        <header className="hud-header animate-slide-in">
          <div className="app-title">
            <Layers size={28} color="var(--accent-primary)" />
            Cava Alpha <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>Spatial Computing</span>
          </div>
          <div className="status-badge glass-panel" style={{ padding: '8px 16px', borderRadius: '30px' }}>
            <div className={`status-dot ${isConnected ? 'connected' : ''}`}></div>
            {isConnected ? 'Backend Online' : 'Aguardando Ligar Python'}
          </div>
        </header>

        <aside className="side-panel animate-slide-in" style={{ animationDelay: '0.2s' }}>
          <div className="glass-panel">
            <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Navigation size={18} color="var(--accent-primary)" />
              Sinais da Mão
            </h3>
            <div className="stat-row">
              <span className="stat-label">Movimento Eixos</span>
              <span className="stat-value">{handData.x.toFixed(1)}, {handData.y.toFixed(1)}</span>
            </div>
            
            <div className="stat-row">
              <span className="stat-label">Rotação X, Y, Z</span>
              <span className="stat-value" style={{color: 'var(--text-muted)'}}>
                  {handData.dir_x.toFixed(1)}, {handData.dir_y.toFixed(1)}, {handData.dir_z.toFixed(1)}
              </span>
            </div>

            <div className="stat-row">
              <span className="stat-label">Modo Zoom (Palma)</span>
              <span className="stat-value" style={{ color: handData.is_open_palm ? '#00ff88' : 'inherit' }}>
                {handData.is_open_palm ? 'ATIVO' : 'FECHADO'}
              </span>
            </div>

            <div className="stat-row" style={{ borderBottom: 'none', marginBottom: 0 }}>
              <span className="stat-label">Pinça (Grab Block)</span>
              <span className="stat-value" style={{ color: handData.is_grabbing ? '#ff00ea' : 'inherit' }}>
                {handData.is_grabbing ? 'AGARRAR' : 'SOLTO'}
              </span>
            </div>
          </div>

          <div className="glass-panel">
             <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BoxSelect size={18} color="var(--accent-primary)" />
              OpenGeoAI & SAM
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: 1.5 }}>
              A rotação dos blocos acompanha o pulso 360º.
            </p>
            <button className="btn" style={{ width: '100%', marginBottom: '12px' }} onClick={handleIsolateBlock}>
              <Scissors size={16} /> Isolar Bloco c/ SAM
            </button>
            <button className="btn" style={{ width: '100%', opacity: 0.8 }}>
              <Activity size={16} /> Exportar Planeamento
            </button>
          </div>
        </aside>
        
        {/* Painel da Câmara Local com sobreposição da IA */}
        <div className="camera-feed-panel animate-slide-in" style={{ animationDelay: '0.4s' }}>
           <div className="label">● Telemetria CV</div>
           <img src="http://localhost:8000/video_feed" alt="Video Feed MediaPipe" />
        </div>
      </div>
    </div>
  );
}

export default App;
