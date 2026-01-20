# Mappedin Venue Format (MVF) Structure

This document explains the structure and components of the Mappedin Venue Format (MVF), specifically focusing on version 3 (MVF v3) as seen in the provided documentation and sample files.

## Overview

MVF is a **GeoJSON-based** data format used to represent indoor venues. It is distributed as a "bundle" (a directory or compressed file) containing multiple JSON and GeoJSON files. The format is designed to be modular, with a "Core" set of files and various "Extensions" that add specific functionality (like navigation, locations, or styling).

## Directory Structure

A typical MVF bundle looks like this:

```text
root/
├── manifest.geojson       # The entry point and index of the bundle
├── floors.geojson         # Definitions of all floors/levels
├── connections.json       # Vertical transport (stairs, elevators) and doors
├── locations.json         # Points of Interest (POIs) metadata
├── geometry/              # Folder containing geometry for each floor
│   ├── f_1.geojson
│   └── f_2.geojson
├── nodes/                 # Navigation graph nodes per floor
│   ├── f_1.geojson
│   └── ...
├── kinds/                 # Semantic classification of geometry (room, wall, etc.)
│   ├── f_1.json
│   └── ...
└── ... (other extensions like annotations, entrance-aesthetic, etc.)
```

## Core Components

### 1. Manifest (`manifest.geojson`)
This is the "brain" of the bundle. It is a GeoJSON FeatureCollection containing a single Point feature.
-   **Geometry**: Represents the center point of the venue.
-   **Properties**: Contains metadata about the venue (name, version, organization ID) and, crucially, the **file index**. It lists every file and folder in the bundle, allowing a parser to know what extensions are present and where to find them.

### 2. Floors (`floors.geojson`)
A FeatureCollection defining the vertical levels of the venue.
-   **Features**: Each feature represents a floor.
-   **Properties**:
    -   `id`: Unique identifier for the floor (e.g., `f_1`).
    -   `elevation`: The vertical height/order of the floor.
    -   `details`: Name and other metadata (e.g., "Ground Floor").

### 3. Geometry (`geometry/`)
This folder contains the actual physical shapes of the venue.
-   **Organization**: One GeoJSON file per floor ID (e.g., `geometry/f_1.geojson`).
-   **Content**: A FeatureCollection of Polygons (rooms, areas), LineStrings (walls, windows), and Points.
-   **IDs**: Every feature has a unique `id` (e.g., `g_123`). These IDs are the "primary keys" used by all other extensions to attach data to these shapes.

## Key Extensions

### Connections (`connections.json`)
Defines how to move between spaces, especially between floors.
-   **Types**: `elevator`, `stairs`, `escalator`, `ramp`, `door`.
-   **Structure**:
    -   `entrances` and `exits`: Arrays referencing specific `geometryId`s on specific `floorId`s.
    -   `costs`: `entryCost` (time/effort to enter) and `floorCostMultiplier` (effort per floor traveled).
-   **Usage**: Used by the pathfinding algorithm to transition between floors or pass through doors.

### Locations (`locations.json`)
Contains the "business" data or Points of Interest (POIs).
-   **Structure**:
    -   `details`: Name, description, logo, etc.
    -   `geometryAnchors`: A list of `geometryId`s that this location is associated with. For example, a "Starbucks" location might be linked to the polygon representing that store's room.
    -   `locationCategories`: Links to categories (e.g., "Food", "Retail").

### Nodes System (`nodes/`)

The Nodes system is the backbone of pathfinding within the venue. It describes the walkable network on each floor.

#### Purpose
-   **Pathfinding**: Defines where a person can walk.
-   **Connectivity**: Links to `Connections` (stairs/elevators) to allow travel between floors.
-   **Context**: Uses `NavigationFlags` to indicate accessibility (e.g., wheelchair accessible paths).

#### File Structure
-   **Organization**: One GeoJSON file per floor, named `f_{floorId}.geojson`.
-   **Format**: A FeatureCollection of Point features.

#### Specification
Each Node is a Point with the following properties:
-   `id`: Unique identifier (e.g., `n_123`).
-   `neighbors`: An array of objects describing connections to other nodes **on the same floor**.
    -   `id`: The ID of the neighbor node.
    -   `extraCost`: Additional cost (>= 0) to travel this edge, on top of physical distance.
    -   `flags`: Navigation flags (e.g., accessible, public).
-   `geometryIds`: An array of geometry IDs linked to this node. This is critical for:
    -   **Destinations**: If a user wants to go to "Room 101", the system looks up the geometry for Room 101, finds the node linked to it, and routes to that node.
    -   **Transitions**: Nodes are often placed at the entrance/exit of `Connections` (like stairs) to bridge the gap between the floor graph and the vertical transport.

#### Example Node
```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [10.0, 10.0] },
  "properties": {
    "id": "n_1",
    "neighbors": [
      { "id": "n_2", "extraCost": 0, "flags": [0] }
    ],
    "geometryIds": ["g_room_1"]
  }
}
```

### Kinds (`kinds/`)
Classifies geometry into semantic types.
-   **Structure**: A mapping of `floorId` -> `geometryId` -> `kind`.
-   **Values**: `room`, `wall`, `corridor`, `area`, `unit`, etc.
-   **Usage**: Helps the renderer decide how to draw an object (e.g., walls are tall and opaque, areas might be flat).

## Data Relationships

The power of MVF lies in how these files link together via IDs:

1.  **Manifest** lists all files.
2.  **Floors** define the `floorId`s (e.g., `f_1`).
3.  **Geometry** files are named by `floorId` and contain features with `geometryId`s (e.g., `g_A`).
4.  **Locations** link a POI (e.g., "Office 101") to `g_A`.
5.  **Kinds** say that `g_A` is a "room".
6.  **Connections** say that `g_B` (a door geometry) connects `f_1` to `f_2`.

## Summary of Workflow

To build a viewer for this data:
1.  Read `manifest.geojson` to find available files.
2.  Load `floors.geojson` to understand the building levels.
3.  For the active floor, load the corresponding `geometry` file to render shapes.
4.  Load `kinds` to style those shapes (e.g., extrude walls).
5.  Load `locations` to place labels and icons on the map.
6.  Load `connections` and `nodes` to build the routing graph for navigation.
