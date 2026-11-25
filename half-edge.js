// Estrutura half-edge baseada em lib do repositorio, estendida com:
//  - busca da estrela de um vertice (faces incidentes) tratando arestas de bordo;
//  - calculo das normais por vertice usando essa estrela.

export class Vertex {
  constructor(vid, x, y, z) {
    this.vid = vid;
    this.position = [x, y, z, 1];
    this.normal = [0, 0, 0, 0];
    this.he = null; // semi-aresta que SAI do vertice (de bordo, se existir)
  }
}

export class HalfEdge {
  constructor(vertex) {
    this.vertex = vertex; // vertice de origem
    this.next = null;
    this.face = null;
    this.opposite = null; // null => aresta de bordo
  }

  get prev() {
    return this.next.next; // faces triangulares
  }
}

export class Face {
  constructor(baseHe) {
    this.baseHe = baseHe;
    this.normal = [0, 0, 0]; // normal nao normalizada (modulo = 2 * area)
  }
}

export class HalfEdgeDS {
  constructor() {
    this.vertices = [];
    this.halfEdges = [];
    this.faces = [];
    this.boundaryHalfEdges = 0;
    this.isolatedVertices = 0;
  }

  /**
   * coords: x,y,z,w por vertice. trigs: tres indices por triangulo.
   */
  build(coords, trigs) {
    for (let i = 0; i < coords.length; i += 4) {
      this.vertices.push(new Vertex(i / 4, coords[i], coords[i + 1], coords[i + 2]));
    }

    for (let t = 0; t < trigs.length; t += 3) {
      const he0 = new HalfEdge(this.vertices[trigs[t]]);
      const he1 = new HalfEdge(this.vertices[trigs[t + 1]]);
      const he2 = new HalfEdge(this.vertices[trigs[t + 2]]);

      const face = new Face(he0);
      he0.face = he1.face = he2.face = face;
      he0.next = he1;
      he1.next = he2;
      he2.next = he0;

      this.faces.push(face);
      this.halfEdges.push(he0, he1, he2);
    }

    this.computeOpposites();
    this.computeVertexHe();
    this.computeFaceNormals();
    this.computeVertexNormals();
  }

  // Liga cada semi-aresta a->b com sua oposta b->a (chave numerica, O(n)).
  computeOpposites() {
    const n = this.vertices.length;
    const open = new Map();

    for (const he of this.halfEdges) {
      const a = he.vertex.vid;
      const b = he.next.vertex.vid;
      const reverse = open.get(b * n + a);

      if (reverse !== undefined && reverse.opposite === null) {
        he.opposite = reverse;
        reverse.opposite = he;
        open.delete(b * n + a);
      } else {
        open.set(a * n + b, he);
      }
    }

    this.boundaryHalfEdges = this.halfEdges.filter((he) => he.opposite === null).length;
  }

  // Cada vertice aponta para uma semi-aresta de saida; prefere uma de bordo,
  // de modo que a rotacao em torno do vertice comece em uma extremidade do leque.
  computeVertexHe() {
    for (const he of this.halfEdges) {
      const v = he.vertex;
      if (v.he === null || he.opposite === null) {
        v.he = he;
      }
    }
    this.isolatedVertices = this.vertices.filter((v) => v.he === null).length;
  }

  /**
   * Percorre a estrela do vertice: chama callback(face) para cada face incidente.
   * Sentido 1: a partir de he (v -> x), a face e he.face; a proxima semi-aresta
   * de saida e he.prev.opposite. Se chegar a uma aresta de bordo (opposite nulo),
   * percorre o outro sentido a partir de he via he.opposite.next.
   */
  forEachFaceAround(vertex, callback) {
    const start = vertex.he;
    if (start === null) {
      return;
    }

    let he = start;
    let hitBoundary = false;
    do {
      callback(he.face);
      const opposite = he.prev.opposite;
      if (opposite === null) {
        hitBoundary = true;
        break;
      }
      he = opposite;
    } while (he !== start);

    if (hitBoundary) {
      he = start;
      while (he.opposite !== null) {
        he = he.opposite.next;
        if (he === start) {
          break;
        }
        callback(he.face);
      }
    }
  }

  computeFaceNormals() {
    for (const face of this.faces) {
      const p0 = face.baseHe.vertex.position;
      const p1 = face.baseHe.next.vertex.position;
      const p2 = face.baseHe.next.next.vertex.position;

      const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      face.normal = [
        u[1] * w[2] - u[2] * w[1],
        u[2] * w[0] - u[0] * w[2],
        u[0] * w[1] - u[1] * w[0],
      ];
    }
  }

  // Normal do vertice = soma (ponderada pela area) das normais das faces da
  // estrela, normalizada. Usa forEachFaceAround, que respeita o bordo.
  computeVertexNormals() {
    for (const v of this.vertices) {
      const sum = [0, 0, 0];
      this.forEachFaceAround(v, (face) => {
        sum[0] += face.normal[0];
        sum[1] += face.normal[1];
        sum[2] += face.normal[2];
      });

      const length = Math.hypot(sum[0], sum[1], sum[2]);
      v.normal = length > 0
        ? [sum[0] / length, sum[1] / length, sum[2] / length, 0]
        : [0, 1, 0, 0];
    }
  }

  getBounds() {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const v of this.vertices) {
      if (v.he === null) continue; // ignora vertices sem face
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c], v.position[c]);
        max[c] = Math.max(max[c], v.position[c]);
      }
    }
    return { min, max };
  }

  getVBOs() {
    const positions = new Float32Array(this.vertices.length * 4);
    const normals = new Float32Array(this.vertices.length * 4);
    this.vertices.forEach((v, i) => {
      positions.set(v.position, i * 4);
      normals.set(v.normal, i * 4);
    });

    const indices = new Uint32Array(this.halfEdges.length);
    this.halfEdges.forEach((he, i) => {
      indices[i] = he.vertex.vid;
    });

    return { positions, normals, indices };
  }
}
