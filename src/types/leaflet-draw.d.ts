declare module 'leaflet-draw' {
  import * as L from 'leaflet';

  namespace L {
    namespace Control {
      interface Draw extends L.Control {
        // Add any specific methods or properties if needed
      }
    }

    namespace DrawEvents {
      interface Created {
        layer: L.Layer;
        layerType: string;
      }

      interface Edited {
        layers: L.LayerGroup;
      }
    }

    namespace Draw {
      interface Event {
        CREATED: string;
        EDITED: string;
      }
    }

    namespace EditToolbar {
      interface Edit {
        new(map: L.Map, options: { featureGroup: L.FeatureGroup }): any;
      }
    }
  }
}
