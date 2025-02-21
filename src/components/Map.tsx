'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Polygon, useMap, LayersControl, Tooltip } from 'react-leaflet';
import dynamic from 'next/dynamic';
import * as mgrs from 'mgrs';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import * as geojson from 'geojson';
import { randomUUID } from 'crypto';

// Explicit type declaration for Leaflet Draw events
declare module 'leaflet' {
  namespace DrawEvents {
    interface Created {
      layer: L.Layer;
      layerType: string;
    }
    
    interface Edited {
      layers: L.LayerGroup;
    }
  }
}

// Local type declaration for AOI
type AOI = {
  id: string;
  mgrsCoordinate: string;
  dimensions: string;
  bounds: [number, number][];
  name: string;
  dateCreated: string;
  layer?: L.Layer;
};

const { BaseLayer } = LayersControl;

const DynamicDrawingControls = dynamic(
  () => import('./DrawingControls').then(mod => mod.default),
  { ssr: false }
);

const DynamicCoordinateControl = dynamic(
  () => import('./CoordinateControl').then(mod => mod.default),
  { ssr: false }
);

const DynamicLayerCleanup = dynamic(
  () => import('./LayerCleanup').then(mod => mod.default),
  { ssr: false }
);

const STORAGE_KEY = 'mgrs-map-aois';
const PROJECT_NAME_KEY = 'mgrs-map-project-name';

// Helper function to safely interact with localStorage
const storage = {
  save: (data: AOI[]) => {
    if (typeof window !== 'undefined') {
      try {
        // Remove any layer references before saving
        const aoisToSave = data.map(({ layer, ...rest }) => rest);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(aoisToSave));
      } catch (error) {
        console.error('Error saving to localStorage:', error);
      }
    }
  },
  load: (): AOI[] => {
    if (typeof window !== 'undefined') {
      try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
      } catch (error) {
        console.error('Error loading from localStorage:', error);
        return [];
      }
    }
    return [];
  }
};

// Utility function to convert AOI to GeoJSON Feature
const aoiToGeoJSON = (aoi: AOI): geojson.Feature => {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [aoi.bounds.map(coord => [coord[1], coord[0]])]
    },
    properties: {
      id: aoi.id,
      name: aoi.name,
      mgrsCoordinate: aoi.mgrsCoordinate,
      dimensions: aoi.dimensions,
      dateCreated: aoi.dateCreated
    }
  };
};

// Utility function to convert GeoJSON Feature to AOI
const geoJSONToAOI = (feature: geojson.Feature): AOI => {
  if (feature.geometry.type !== 'Polygon') {
    throw new Error('Only Polygon geometries are supported');
  }

  // Swap coordinates back to [lat, lon]
  const bounds = feature.geometry.coordinates[0].map(coord => 
    [coord[1], coord[0]] as [number, number]
  );

  return {
    id: feature.properties?.id || randomUUID(),
    name: feature.properties?.name || 'Imported AOI',
    mgrsCoordinate: feature.properties?.mgrsCoordinate || '',
    dimensions: feature.properties?.dimensions || '',
    bounds: bounds,
    dateCreated: feature.properties?.dateCreated || new Date().toISOString()
  };
};

// Function to import GeoJSON file
const importGeoJSON = (file: File, setAois: (aois: AOI[]) => void) => {
  return new Promise<void>((resolve, reject) => {
    if (!file) {
      reject(new Error('No file provided'));
      return;
    }

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.geojson') && file.type !== 'application/geo+json') {
      console.warn('Unexpected file type:', file.type, 'Filename:', file.name);
    }

    const reader = new FileReader();
    
    reader.onerror = (e) => {
      console.error('FileReader error:', e);
      reject(new Error('Error reading file'));
    };

    reader.onload = (e) => {
      try {
        const fileContent = e.target?.result as string;
        console.log('File content:', fileContent.slice(0, 500) + '...'); // Log first 500 chars

        const geoJSONData = JSON.parse(fileContent);
        
        // Validate GeoJSON structure
        if (!geoJSONData.type) {
          throw new Error('Invalid GeoJSON: Missing type property');
        }

        // Handle both FeatureCollection and single Feature
        const features = geoJSONData.type === 'FeatureCollection' 
          ? geoJSONData.features 
          : geoJSONData.type === 'Feature' 
            ? [geoJSONData]
            : [];
        
        if (features.length === 0) {
          throw new Error('No valid features found in GeoJSON');
        }

        const importedAois = features
          .filter((feature: geojson.Feature) => feature.geometry?.type === 'Polygon')
          .map(geoJSONToAOI);
        
        if (importedAois.length === 0) {
          throw new Error('No Polygon features found in GeoJSON');
        }

        console.log('Imported AOIs:', importedAois);
        setAois(importedAois);
        resolve();
      } catch (error) {
        console.error('Error parsing GeoJSON:', error);
        reject(error);
      }
    };

    reader.readAsText(file);
  });
};

function MapContent({ 
  aois, 
  setAois, 
  onCreated,
  selectedAoiId,
  setSelectedAoiId,
  onMapClick,
  isEditing,
  setIsEditing,
  zoomToBounds
}: { 
  aois: AOI[], 
  setAois: (aois: AOI[]) => void,
  onCreated: (e: L.DrawEvents.Created) => void,
  selectedAoiId: string | null,
  setSelectedAoiId: (id: string | null) => void,
  onMapClick: () => void,
  isEditing: boolean,
  setIsEditing: (isEditing: boolean) => void,
  zoomToBounds: (bounds: [number, number][]) => void
}) {
  const map = useMap();
  const [editMode, setEditMode] = useState(false);
  const editableLayerRef = useRef<L.Polygon | null>(null);
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const drawControlRef = useRef<L.Control.Draw | null>(null);

  // Initialize feature group and draw control
  useEffect(() => {
    // Create feature group
    featureGroupRef.current = new L.FeatureGroup();
    featureGroupRef.current.addTo(map);

    // Create draw control
    const drawControl = new (L as any).Control.Draw({
      draw: {
        polygon: true,
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false
      },
      edit: {
        featureGroup: featureGroupRef.current,
        remove: false
      }
    });

    // Add draw control to map
    map.addControl(drawControl);
    drawControlRef.current = drawControl;

    // Listen for draw created event
    const drawCreatedHandler = (e: L.DrawEvents.Created) => {
      const layer = e.layer;
      onCreated(e);
    };
    map.on(L.Draw.Event.CREATED, drawCreatedHandler);

    // Cleanup function
    return () => {
      if (featureGroupRef.current) {
        map.removeLayer(featureGroupRef.current);
      }
      if (drawControlRef.current) {
        map.removeControl(drawControlRef.current);
      }
      map.off(L.Draw.Event.CREATED, drawCreatedHandler);
    };
  }, [map, onCreated]);

  // Add AOIs to feature group
  useEffect(() => {
    if (!featureGroupRef.current) return;

    // Clear existing layers
    featureGroupRef.current.clearLayers();

    // Add polygon for each AOI
    aois.forEach(aoi => {
      const polygon = L.polygon(
        aoi.bounds.map(coord => [coord[0], coord[1]]),
        {
          color: aoi.id === selectedAoiId ? 'blue' : 'red',
          weight: aoi.id === selectedAoiId ? 3 : 2
        }
      );
      
      polygon.addTo(featureGroupRef.current);
    });
  }, [aois, selectedAoiId]);

  // Effect to zoom to selected AOI
  useEffect(() => {
    if (selectedAoiId) {
      const selectedAoi = aois.find(aoi => aoi.id === selectedAoiId);
      if (selectedAoi) {
        // Calculate bounds of the AOI
        const aoiBounds = L.latLngBounds(
          selectedAoi.bounds.map(coord => [coord[0], coord[1]])
        );
        
        // Fit the map to the AOI bounds with some padding
        map.fitBounds(aoiBounds, {
          padding: [50, 50], // 50 pixels padding on all sides
          maxZoom: 12 // Prevent zooming in too close
        });
      }
    }
  }, [selectedAoiId, aois, map]);

  // Handle selected AOI
  useEffect(() => {
    if (!map || !featureGroupRef.current || !drawControlRef.current) return;

    // Clear existing features
    featureGroupRef.current.clearLayers();

    if (selectedAoiId) {
      const selectedAoi = aois.find(aoi => aoi.id === selectedAoiId);
      if (selectedAoi) {
        const layer = new L.Polygon(selectedAoi.bounds, {
          color: editMode ? 'red' : '#444',
          weight: 3,
          opacity: 0.8
        });
        featureGroupRef.current.addLayer(layer);
        editableLayerRef.current = layer;

        // Start edit mode if enabled
        if (editMode) {
          const EditHandler = (L as any).EditToolbar.Edit;
          const handler = new EditHandler(map, {
            featureGroup: featureGroupRef.current
          });
          handler.enable();
        }
      }
    }
  }, [map, selectedAoiId, editMode, aois]);

  // Handle edit events
  useEffect(() => {
    if (!map) return;

    const handleEdit = (e: L.DrawEvents.Edited) => {
      const layers = e.layers;
      layers.eachLayer((layer: L.Polygon) => {
        const newBounds = layer.getLatLngs()[0] as L.LatLng[];
        setAois(currentAois => 
          currentAois.map(aoi => 
            aoi.id === selectedAoiId 
              ? { ...aoi, bounds: newBounds }
              : aoi
          )
        );
      });
      setEditMode(false);
      setIsEditing(false);
    };

    const handleEditStop = () => {
      setEditMode(false);
      setIsEditing(false);
    };

    map.on(L.Draw.Event.EDITED, handleEdit);
    map.on(L.Draw.Event.EDITSTOP, handleEditStop);

    return () => {
      map.off(L.Draw.Event.EDITED, handleEdit);
      map.off(L.Draw.Event.EDITSTOP, handleEditStop);
    };
  }, [map, selectedAoiId]);

  return (
    <>
      <DynamicLayerCleanup aois={aois} />
      <DynamicDrawingControls onCreated={onCreated} />
      <DynamicCoordinateControl />
      <LayersControl position="topright">
        <BaseLayer checked name="OpenStreetMap">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </BaseLayer>
        <BaseLayer name="World Imagery">
          <TileLayer
            attribution='&copy; <a href="https://www.arcgis.com/">ArcGIS</a>'
            url="https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/49849/{z}/{y}/{x}"
            maxZoom={19}
          />
        </BaseLayer>
      </LayersControl>
      {aois.map((aoi) => (
        <Polygon
          key={aoi.id}
          positions={aoi.bounds}
          pathOptions={{ 
            color: '#444',
            weight: 3,
            fillOpacity: aoi.id === selectedAoiId && !editMode ? 0.2 : 0,
            opacity: aoi.id === selectedAoiId ? 0 : 0.8 // Hide the original polygon when selected
          }}
          eventHandlers={{
            click: (e) => {
              e.originalEvent.stopPropagation();
              setSelectedAoiId(aoi.id);
            },
            contextmenu: (e) => {
              e.originalEvent.preventDefault();
              e.originalEvent.stopPropagation();
              if (aoi.id === selectedAoiId) {
                setEditMode(true);
                setIsEditing(true);
              } else {
                setSelectedAoiId(aoi.id);
              }
            }
          }}
        >
          <Tooltip permanent direction="center" className="aoi-label">
            {aoi.name}
          </Tooltip>
        </Polygon>
      ))}
    </>
  );
}

export default function Map() {
  const [aois, setAois] = useState<AOI[]>([]);
  const [mgrsInput, setMgrsInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [selectedAoiId, setSelectedAoiId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [projectName, setProjectName] = useState('Untitled Project');
  const [editingProject, setEditingProject] = useState(false);
  const [tempProjectName, setTempProjectName] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  const ImportModal = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[1000]">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Import GeoJSON</h2>
        <input
          type="file"
          accept=".geojson"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setImportFile(file);
            }
          }}
          className="mb-4 p-2 border rounded w-full"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setShowImportModal(false)}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (importFile) {
                const reader = new FileReader();
                reader.onload = (e) => {
                  try {
                    const geojson = JSON.parse(e.target?.result as string);
                    const newAois = geojson.features.map((feature: any) => geoJSONToAOI(feature));
                    setAois([...aois, ...newAois]);
                  } catch (error) {
                    console.error('Error parsing GeoJSON:', error);
                    alert('Invalid GeoJSON file');
                  }
                };
                reader.readAsText(importFile);
              }
              setShowImportModal(false);
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );

  useEffect(() => {
    // Ensure this only runs on client-side
    if (typeof window !== 'undefined') {
      // Load AOIs
      const loadedAois = storage.load();
      
      // If we have saved AOIs, set them
      if (loadedAois.length > 0) {
        setAois(loadedAois);
      }

      // Load project name
      const savedProjectName = localStorage.getItem(PROJECT_NAME_KEY);
      if (savedProjectName) {
        setProjectName(savedProjectName);
      }
    }
  }, []);

  useEffect(() => {
    storage.save(aois);
  }, [aois]);

  useEffect(() => {
    localStorage.setItem(PROJECT_NAME_KEY, projectName);
  }, [projectName]);

  const startEditing = (aoi: AOI) => {
    setEditingId(aoi.id);
    setEditingName(aoi.name);
  };

  const saveEdit = () => {
    if (!editingId) return;
    
    setAois(aois.map(aoi => 
      aoi.id === editingId 
        ? { ...aoi, name: editingName.trim() || aoi.name }
        : aoi
    ));
    setEditingId(null);
    setEditingName('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      setEditingId(null);
      setEditingName('');
    }
  };

  const getAverageLatLng = (coords: L.LatLng[]) => {
    const sum = coords.reduce(
      (acc, curr) => [acc[0] + curr.lat, acc[1] + curr.lng],
      [0, 0]
    );
    return [
      sum[0] / coords.length,
      sum[1] / coords.length,
    ];
  };

  const handleCreated = (e: L.DrawEvents.Created) => {
    const layer = e.layer;
    const coords = layer.getLatLngs()[0];
    const latLngs = coords as L.LatLng[];

    // Convert coordinates to MGRS
    const mgrsCoords = latLngs.map(latlng => 
      mgrs.forward(latlng.lat, latlng.lng)
    );

    // Get the center coordinate
    const centerLat = latLngs.reduce((sum, latlng) => sum + latlng.lat, 0) / latLngs.length;
    const centerLng = latLngs.reduce((sum, latlng) => sum + latlng.lng, 0) / latLngs.length;
    const centerMgrs = mgrs.forward(centerLat, centerLng);

    // Create new AOI
    const newAoi: AOI = {
      id: randomUUID(),
      name: `AOI ${aois.length + 1}`,
      mgrsCoordinate: centerMgrs,
      dimensions: `${calculatePolygonArea(latLngs).toFixed(2)} sq m`,
      bounds: latLngs.map(latlng => [latlng.lng, latlng.lat] as [number, number]),
      dateCreated: new Date().toISOString(),
      layer: layer
    };

    // Add the new AOI
    const updatedAois = [...aois, newAoi];
    setAois(updatedAois);
    storage.save(updatedAois);

    // Zoom to the newly created AOI
    if (latLngs.length > 0) {
      zoomToBounds(newAoi.bounds);
    }
  };

  const deleteAOI = (id: string) => {
    if (window.confirm('Are you sure you want to delete this AOI?')) {
      const aoiToDelete = aois.find(aoi => aoi.id === id);
      if (aoiToDelete?.layer) {
        aoiToDelete.layer.remove();
      }
      setAois(aois.filter(aoi => aoi.id !== id));
    }
  };

  const addAOI = () => {
    if (!mgrsInput) return;

    try {
      // mgrs.toPoint returns [longitude, latitude]
      const [lng, lat] = mgrs.toPoint(mgrsInput);
      
      const bounds = [
        [lat - 0.01, lng - 0.01],
        [lat - 0.01, lng + 0.01],
        [lat + 0.01, lng + 0.01],
        [lat + 0.01, lng - 0.01],
      ] as [number, number][];

      const newAOI: AOI = {
        id: Date.now().toString(),
        mgrsCoordinate: mgrsInput,
        dimensions: '',
        bounds: bounds,
        name: `AOI ${aois.length + 1}`,
        dateCreated: new Date().toISOString()
      };

      setAois([...aois, newAOI]);
      setMgrsInput('');
    } catch (error) {
      alert('Invalid MGRS coordinate');
    }
  };

  const exportToGeoJSON = () => {
    try {
      const features = aois.map(aoi => aoiToGeoJSON(aoi));

      const geoJSON = {
        type: 'FeatureCollection',
        properties: {
          projectName: projectName,
          exportDate: new Date().toISOString()
        },
        features: features
      };

      const dataStr = JSON.stringify(geoJSON, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      
      const currentDate = new Date().toISOString();
      const sanitizedProjectName = projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const exportName = `${sanitizedProjectName}_aois_${currentDate.split('T')[0]}.geojson`;
      
      link.download = exportName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting GeoJSON:', error);
      alert('Error exporting GeoJSON file');
    }
  };

  const handleMapClick = () => {
    if (!isEditing) {
      setSelectedAoiId(null);
    }
  };

  const handleProjectNameChange = () => {
    const trimmedName = tempProjectName.trim();
    if (trimmedName) {
      setProjectName(trimmedName);
    }
    setEditingProject(false);
  };

  const handleProjectKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleProjectNameChange();
    } else if (e.key === 'Escape') {
      setEditingProject(false);
      setTempProjectName(projectName);
    }
  };

  const startEditingProject = () => {
    setTempProjectName(projectName);
    setEditingProject(true);
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
    }
  };

  const handleImport = () => {
    if (importFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const geojson = JSON.parse(e.target?.result as string);
          const newAois = geojson.features.map((feature: any) => geoJSONToAOI(feature));
          setAois([...aois, ...newAois]);
        } catch (error) {
          console.error('Error parsing GeoJSON:', error);
          alert('Invalid GeoJSON file');
        }
      };
      reader.readAsText(importFile);
    }
  };

  // Example of converting a single AOI to GeoJSON
  const singleAoiGeoJSON = aois.length > 0 ? aoiToGeoJSON(aois[0]) : null;

  // Optional: Log the GeoJSON for debugging or demonstration
  useEffect(() => {
    if (singleAoiGeoJSON) {
      console.log('First AOI as GeoJSON:', JSON.stringify(singleAoiGeoJSON, null, 2));
    }
  }, [singleAoiGeoJSON]);

  const zoomToBounds = useCallback((bounds: [number, number][]) => {
    if (bounds.length > 0) {
      const latLngBounds = L.latLngBounds(bounds);
      mapRef.current?.fitBounds(latLngBounds, {
        padding: [50, 50], // 50 pixels padding on all sides
        maxZoom: 12 // Prevent zooming in too close
      });
    }
  }, []);

  return (
    <div className="flex flex-1 h-full ">
      <div 
        id="panel"
        className="w-80 bg-white border-r border-gray-200 flex flex-col h-full max-h-screen overflow-y-auto"
      >
        <div className="p-4 sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-700">
              {editingProject ? (
                <input
                  type="text"
                  value={tempProjectName}
                  onChange={(e) => setTempProjectName(e.target.value)}
                  onBlur={handleProjectNameChange}
                  onKeyDown={handleProjectKeyPress}
                  className="w-full border rounded p-1"
                />
              ) : (
                projectName
              )}
            </h2>
            {!editingProject && (
              <button 
                onClick={startEditingProject}
                className="text-gray-500 hover:text-gray-700"
              >
                ✏️
              </button>
            )}
          </div>
        </div>
        <div className="p-4 flex-grow overflow-y-auto">
          <div className="flex gap-2 mb-4">
            <div className="relative flex-1 group">
              <button
                onClick={() => setShowImportModal(true)}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 w-full flex items-center justify-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-[2000]">
                Import GeoJSON
              </div>
            </div>
            <div className="relative flex-1 group">
              <button
                onClick={exportToGeoJSON}
                className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 w-full flex items-center justify-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-[2000]">
                Export GeoJSON
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-gray-700">Areas of Interest</h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (aois.length > 0) {
                    const bounds = aois.flatMap(aoi => aoi.bounds);
                    const minLat = Math.min(...bounds.map(b => b[0]));
                    const maxLat = Math.max(...bounds.map(b => b[0]));
                    const minLng = Math.min(...bounds.map(b => b[1]));
                    const maxLng = Math.max(...bounds.map(b => b[1]));
                    
                    zoomToBounds([
                      [minLat, minLng],
                      [maxLat, maxLng]
                    ]);
                  }
                }}
                className="text-blue-500 hover:text-blue-700 p-1"
                title="Zoom to All AOIs"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M12.9 14.32a8 8 0 1 1 1.41-1.41l5.35 5.33-1.42 1.42-5.33-5.34zM8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zm0-2a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
                </svg>
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Are you sure you want to delete all Areas of Interest?')) {
                    setAois([]);
                  }
                }}
                className="text-red-500 hover:text-red-700 p-1"
                title="Delete All"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0111 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
          {aois.map((aoi) => (
            <div 
              key={aoi.id} 
              className={`p-2 mb-2 border rounded cursor-pointer ${
                selectedAoiId === aoi.id 
                  ? 'bg-blue-100 border-blue-300' 
                  : 'hover:bg-gray-100'
              }`}
              onClick={() => {
                setSelectedAoiId(selectedAoiId === aoi.id ? null : aoi.id);
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex-1">
                  {editingId === aoi.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={saveEdit}
                      onKeyDown={handleKeyPress}
                      className="w-full p-1 border rounded"
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span 
                      className="font-medium text-sm text-gray-900 hover:text-blue-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing(aoi);
                      }}
                    >
                      {aoi.name}
                    </span>
                  )}
                </div>
                <div className="flex gap-1 ml-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAOI(aoi.id);
                    }}
                    className="text-red-500 hover:text-red-700 p-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0111 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="text-xs text-gray-500">
                {aoi.mgrsCoordinate} ({aoi.dimensions})
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={mgrsInput}
              onChange={(e) => setMgrsInput(e.target.value)}
              placeholder="Enter MGRS coordinate"
              className="flex-1 p-2 border rounded"
              disabled={isEditing}
            />
            <button 
              onClick={addAOI} 
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
              disabled={isEditing}
            >
              Add
            </button>
          </div>

          <div className="flex flex-col gap-2 mb-4">
          </div>
        </div>
      </div>
      
      <div className="flex-1 relative">
        <MapContainer
          center={[49.8283, -99.5795]}
          zoom={8}
          className="absolute inset-0 w-full h-full"
          ref={mapRef}
        >
          <MapContent 
            aois={aois} 
            setAois={setAois} 
            onCreated={handleCreated}
            selectedAoiId={selectedAoiId}
            setSelectedAoiId={setSelectedAoiId}
            onMapClick={handleMapClick}
            isEditing={isEditing}
            setIsEditing={setIsEditing}
            zoomToBounds={zoomToBounds}
          />
        </MapContainer>
      </div>
      {showImportModal && <ImportModal />}
    </div>
  );
}
