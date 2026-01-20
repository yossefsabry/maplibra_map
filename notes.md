

Think of them as "Google Maps for the indoors." While GPS works great for finding a building,
it often fails once you're inside a complex structure like a mall or an airport. That’s the problem Mappedin solves.


1. The "Graph" (The Hidden Web)
Even though you see a beautiful 3D map, underneath it lies a mathematical Graph.

Nodes: These are invisible points placed throughout the walkable areas (hallways, rooms, entrances). In Mappedin, these nodes often carry "metadata," such as which floor they are on or if they are near an elevator.

Edges: These are the connections between nodes. Each "edge" has a weight, which usually represents the physical distance. If a path goes from Node A to Node B, the algorithm "costs" it based on that distance.

2. How the Algorithm Navigates the Nodes
When you ask for directions, the engine performs a search:

Dijkstra's: It explores all possible directions from your start node, gradually moving outward until it hits your destination. It ensures you get the absolute shortest path.

A* (The "Smart" Version): Mappedin likely uses A* because it's faster for web browsers. It uses a "heuristic" (an educated guess) to prioritize nodes that are physically closer to the destination, meaning it doesn't waste time checking paths that lead the wrong way.

Multi-Floor Logic: This is the "secret sauce." To go from Floor 1 to Floor 2, the algorithm treats an elevator or stairs as a special "edge" that connects a node on one map to a node on another.

3. Making it Look "Nice" (Path Smoothing)
If a person just followed nodes, the path might look "zig-zaggy" or robotic. Mappedin applies Path Smoothing after the algorithm finds the route. It "pulls the string" tight on the calculated path to create the smooth, curved, or straight lines you see in their online preview.

4. Special Constraints (Accessibility)
Mappedin's node system is "tagged." If you toggle "Accessible Route," the algorithm temporarily "deletes" or ignores any edges that represent stairs. It then re-calculates the path using only "Elevator" or "Ramp" nodes.


1. gone adding a game system like moving with the keys on the map so i want 
to handle and moving
