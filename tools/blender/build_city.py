# Construit les bâtiments de la rue de la Lagune en détail dans Blender et précalcule leurs ombres de contact + salissures.
# Entrée  : tools/blender/city_spec.json (description exportée par le jeu : world.buildingSpecs + échelles de textures)
# Sortie  : assets/city/rue_lagune.glb — un objet par bâtiment (b0, b1…), aux mêmes emprises que dans le jeu.
#   - matériaux nommés par leur clé du jeu (« cream », « tint:plaster:#e9e7e2 », « paint:#2f3338:0.4:0.7 », « glass », « dark ») :
#     le jeu remet ses propres matériaux PBR ;
#   - UV0 en mètres / échelle de la texture (comme les boîtes du jeu) ; UV1 = atlas précalculé :
#     R = occlusion ambiante (coins, dessous de balcons, pied des murs), G = salissure (éclaboussures de latérite, coulures).
# Usage : Blender -b --python tools/blender/build_city.py
import bpy, bmesh, json, os, math, random
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SPEC = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'city_spec.json')))
OUT = os.path.join(ROOT, 'assets', 'city', 'rue_lagune.glb')
ATLAS = int(os.environ.get('ATLAS', 4096))
random.seed(7)


def tile_of(key):
    if key.startswith('tint:'):
        return SPEC['tiles'].get(key.split(':')[1], 2)
    return SPEC['tiles'].get(key, 2) if not key.startswith('paint') else 1.0


class Builder:
    """Un bâtiment = un seul bmesh multi-matériaux, construit en coordonnées du jeu (y vers le haut, façade vers +z)."""

    def __init__(self, name):
        self.name, self.bm, self.mats = name, bmesh.new(), []

    def mi(self, key):
        if key not in self.mats:
            self.mats.append(key)
        return self.mats.index(key)

    def _finish(self, verts, key, bevel):
        faces = {f for v in verts for f in v.link_faces}
        idx = self.mi(key)
        for f in faces:
            f.material_index = idx
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=2, affect='EDGES', profile=0.5, clamp_overlap=True)

    def box(self, w, h, d, x, y, z, key, bevel=0.0, rx=0.0, ry=0.0):
        if w <= 1e-3 or h <= 1e-3 or d <= 1e-3:
            return
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Diagonal((w, h, d, 1))
        for v in r['verts']:
            v.co = M @ v.co
        self._finish(r['verts'], key, min(bevel, w / 3, h / 3, d / 3))

    def cyl(self, r, h, x, y, z, key, seg=10, axis='Y', r2=None):
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
        rot = {'Y': Matrix.Rotation(-math.pi / 2, 4, 'X'), 'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Z': Matrix.Identity(4)}[axis]
        M = Matrix.Translation((x, y, z)) @ rot
        for v in res['verts']:
            v.co = M @ v.co
        self._finish(res['verts'], key, 0)

    def plane(self, w, h, x, y, z, key, rx=0.0, ry=0.0):
        r = bmesh.ops.create_grid(self.bm, x_segments=1, y_segments=1, size=0.5)
        M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Diagonal((w, h, 1, 1))
        for v in r['verts']:
            v.co = M @ v.co
        self._finish(r['verts'], key, 0)

    def wall(self, u0, u1, v0, v1, holes, thick, place, key, bevel=0.012):
        """Mur plein percé de trous rectangulaires (u le long du mur, v vers le haut), découpé en bandes : pas de booléen.
        place(u, v, du, dv) → pose une boîte du mur."""
        xs = sorted({u0, u1, *[c for hx0, hx1, _, _ in holes for c in (max(u0, hx0), min(u1, hx1))]})
        for a, b in zip(xs, xs[1:]):
            if b - a < 1e-3:
                continue
            mid = (a + b) / 2
            cuts = sorted((hy0, hy1) for hx0, hx1, hy0, hy1 in holes if hx0 < mid < hx1)
            y = v0
            for hy0, hy1 in cuts + [(v1, v1)]:
                if hy0 - y > 1e-3:
                    place((a + b) / 2, (y + hy0) / 2, b - a, hy0 - y)
                y = max(y, hy1)

    def to_object(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(ob)
        for key in self.mats:
            me.materials.append(material(key))
        return ob


_mats = {}


def material(key):
    if key not in _mats:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        _mats[key] = m
    return _mats[key]


# ---------------------------------------------------------------- éléments d'architecture
def window_unit(B, cx, cy, fz, w, h, trim, side=None):
    """Fenêtre « naco » en retrait : tableau, appui saillant, lames de verre, grille anti-effraction.
    fz = plan de façade ; side = None (façade +z) ou ±1 (mur latéral ±x, tourné)."""
    ry = 0 if side is None else side * math.pi / 2

    def P(dx, dy, dz):  # repère local de la fenêtre → monde (z local = vers l'extérieur)
        v = Matrix.Rotation(ry, 3, 'Y') @ Vector((dx, dy, dz))
        return (cx + v.x, cy + v.y, fz + v.z) if side is None else (cx + v.x, cy + v.y, fz + v.z)

    rec = 0.14  # profondeur du retrait
    B.plane(w, h, *P(0, 0, -rec), 'dark', ry=ry)
    for (bw, bh, bd, dx, dy, dz) in [(w + 0.1, 0.06, 0.08, 0, h / 2 + 0.03, 0.02), (w + 0.1, 0.06, 0.08, 0, -h / 2 - 0.03, 0.02),
                                     (0.06, h, 0.08, -w / 2 - 0.03, 0, 0.02), (0.06, h, 0.08, w / 2 + 0.03, 0, 0.02)]:
        B.box(bw, bh, bd, *P(dx, dy, dz), trim, bevel=0.006, ry=ry)
    B.box(w + 0.3, 0.07, 0.24, *P(0, -h / 2 - 0.1, 0.06), 'concreteTop', bevel=0.012, ry=ry)  # appui
    n = max(4, round(h / 0.11))
    halves = 2 if w > 1 else 1
    for c in range(halves):
        cw = w / halves
        x0 = -w / 2 + cw * (c + 0.5)
        for i in range(n):
            B.box(cw - 0.06, h / n * 1.05, 0.006, *P(x0, -h / 2 + (i + 0.5) * h / n, -rec + 0.05), 'glass', rx=-0.45, ry=ry)
        if c == 1:
            B.box(0.04, h, 0.04, *P(0, 0, -rec + 0.06), trim, ry=ry)
    nb = max(2, round(w / 0.13))
    for i in range(1, nb):
        p = P(-w / 2 + i * w / nb, 0, 0.05)
        B.cyl(0.009, h, *p, trim, seg=6)
    for yy in (-h / 3, h / 3):
        B.box(w, 0.025, 0.014, *P(0, yy, 0.05), trim, ry=ry)


def door_unit(B, cx, fz, w, h, panel, trim):
    B.box(w + 0.16, 0.09, 0.14, cx, h + 0.045, fz + 0.03, trim, bevel=0.008)
    for sx in (-1, 1):
        B.box(0.08, h, 0.14, cx + sx * (w / 2 + 0.04), h / 2, fz + 0.03, trim, bevel=0.008)
    B.box(w, h, 0.05, cx, h / 2, fz - 0.05, panel, bevel=0.006)
    for yy in (0.28, 0.62):
        B.box(w * 0.82, 0.03, 0.02, cx, yy * h, fz - 0.015, trim)
    B.cyl(0.016, 0.14, cx + w / 2 - 0.13, h * 0.48, fz + 0.02, 'paint:#c9b27a:0.3:0.9', seg=8, axis='Z')


def corrugated(B, w, length, x, y, z, slope, key):
    pitch, amp = 0.076, 0.016
    seg = int(w / pitch * 4)
    r = bmesh.ops.create_grid(B.bm, x_segments=seg, y_segments=2, size=0.5)
    M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(slope, 4, 'X') @ Matrix.Rotation(-math.pi / 2, 4, 'X')
    for v in r['verts']:
        lx, ly = v.co.x * w, v.co.y * length
        v.co = M @ Vector((lx, ly, math.sin(lx / pitch * math.pi * 2) * amp))
    B._finish(r['verts'], key, 0)
    # épaisseur visible par en dessous : deuxième face (même géométrie, légèrement plus bas)
    r2 = bmesh.ops.duplicate(B.bm, geom=[f for f in {f for v in r['verts'] for f in v.link_faces}])
    for v in [g for g in r2['geom'] if isinstance(g, bmesh.types.BMVert)]:
        v.co.y -= 0.004
    bmesh.ops.reverse_faces(B.bm, faces=[g for g in r2['geom'] if isinstance(g, bmesh.types.BMFace)])


def polytank(B, x, y, z):
    B.cyl(0.55, 1.2, x, y + 0.6, z, 'paint:#1a1a1a:0.5:0', seg=24)
    for k in range(5):  # nervures
        B.cyl(0.565, 0.035, x, y + 0.15 + k * 0.22, z, 'paint:#1a1a1a:0.5:0', seg=24)
    B.cyl(0.55, 0.12, x, y + 1.26, z, 'paint:#1a1a1a:0.5:0', seg=24, r2=0.2)
    B.cyl(0.04, 1.4, x + 0.6, y + 0.3, z, 'paint:#e6e2d8:0.5:0', seg=8, axis='X')  # tuyau vers la descente


def building(spec):
    s = spec
    B = Builder(s['id'])
    x, zf, w, d, F, fh = s['x'], s['zFront'], s['w'], s['d'], s['floors'], s['fh']
    wall, upper, trim = s['wall'], s['upperWall'], s['trim']
    t, H = 0.22, F * fh
    zc, zb = zf - d / 2, zf - d
    ops = s['openings']
    # ---------- rez-de-chaussée ----------
    holes = []
    for op in ops:
        if op['type'] == 'window':
            holes.append((x + op['x'] - op['w'] / 2, x + op['x'] + op['w'] / 2, 1.55 - op['h'] / 2, 1.55 + op['h'] / 2))
        else:
            holes.append((x + op['x'] - op['w'] / 2, x + op['x'] + op['w'] / 2, 0, op['h']))
    B.wall(x - w / 2, x + w / 2, 0, fh, holes, t, lambda u, v, du, dv: B.box(du, dv, t, u, v, zf - t / 2, wall, bevel=0.01), wall)
    B.box(t, fh, d, x - w / 2 + t / 2, fh / 2, zc, wall, bevel=0.012)
    B.box(t, fh, d, x + w / 2 - t / 2, fh / 2, zc, wall, bevel=0.012)
    B.box(w, fh, t, x, fh / 2, zb + t / 2, wall, bevel=0.012)
    B.box(w - 0.1, 0.2, d - 0.1, x, fh - 0.1, zc, 'concreteTop')
    B.box(w - 0.3, 0.06, d - 0.3, x, 0.03, zc, s['floorMat'])
    # soubassement sali (latérite) : plinthe légèrement saillante
    plinth_holes = [(a, b, 0, 0.6) for a, b, y0, _ in holes if y0 < 0.5]
    B.wall(x - w / 2, x + w / 2, 0, 0.5, plinth_holes, 0.03, lambda u, v, du, dv: B.box(du, dv, 0.03, u, v, zf + 0.012, 'plinth', bevel=0.005), 'plinth')
    for sx in (-1, 1):
        B.box(0.03, 0.5, d, x + sx * (w / 2 + 0.012), 0.25, zc, 'plinth', bevel=0.005)
    for op in ops:
        ox = x + op['x']
        if op['type'] == 'window':
            window_unit(B, ox, 1.55, zf, op['w'], op['h'], trim)
        elif op['type'] == 'door':
            door_unit(B, ox, zf - 0.08, op['w'] - 0.14, op['h'] - 0.08, op['mat'], trim)
        else:  # vitrine / boutique : linteau en béton et tableau
            B.box(op['w'] + 0.2, 0.18, 0.28, ox, op['h'] + 0.09, zf + 0.02, 'concreteTop', bevel=0.012)
    # ---------- étages ----------
    top_f = F - 1 if s['unfinished'] else F
    if F > 1:
        for f in range(1, F):
            y0 = f * fh
            if s['unfinished'] and f == F - 1:
                wh = 1.9
                B.box(w, wh, 0.2, x, y0 + wh / 2, zf - 0.1, 'blocks', bevel=0.004)
                B.box(0.2, wh * 0.7, d, x - w / 2 + 0.1, y0 + wh * 0.35, zc, 'blocks', bevel=0.004)
                B.box(0.2, wh, d, x + w / 2 - 0.1, y0 + wh / 2, zc, 'blocks', bevel=0.004)
                B.box(w, 0.2, d, x, y0 + 0.02, zc, 'concreteTop')
                for cx in (x - w / 2 + 0.15, x, x + w / 2 - 0.15):
                    for cz in (zf - 0.15, zb + 0.15):
                        B.box(0.25, fh + 0.2, 0.25, cx, y0 + (fh + 0.2) / 2, cz, 'concreteTop', bevel=0.01)
                        for ox in (-0.07, 0.07):
                            for oz in (-0.07, 0.07):
                                B.cyl(0.007, 0.9, cx + ox, y0 + fh + 0.6, cz + oz, 'paint:#5a3a26:0.7:0.6', seg=4)
                continue
            wins = []
            nw = s['windows']
            bal_i = nw // 2 if (s['balcony'] and nw % 2 == 1) else -1
            for i in range(nw):
                wx = x - w / 2 + (i + 0.5) * w / nw
                if i == bal_i:
                    wins.append(('door', wx, 0.9, 2.1))
                else:
                    wins.append(('win', wx, 1.3, 1.25))
            hl = [(wx - ww / 2, wx + ww / 2, y0 + (0.16 if k == 'door' else 1.55 - hh / 2), y0 + (0.16 + hh if k == 'door' else 1.55 + hh / 2)) for k, wx, ww, hh in wins]
            B.wall(x - w / 2, x + w / 2, y0, y0 + fh, hl, t, lambda u, v, du, dv: B.box(du, dv, t, u, v, zf - t / 2, upper, bevel=0.01), upper)
            # murs latéraux avec une fenêtre chacun, mur arrière
            zw = zc - d / 6
            for sx in (-1, 1):
                B.wall(zb, zf - t, y0, y0 + fh, [(zw - 0.45, zw + 0.45, y0 + 1.0, y0 + 2.1)], t,
                       lambda u, v, du, dv, sx=sx: B.box(t, dv, du, x + sx * (w / 2 - t / 2), v, u, upper, bevel=0.01), upper)
                window_unit(B, x + sx * w / 2, y0 + 1.55, zw, 0.9, 1.1, trim, side=sx)
            B.box(w, fh, t, x, y0 + fh / 2, zb + t / 2, upper, bevel=0.012)
            B.box(w - 0.2, 0.2, d - 0.2, x, y0 + fh - 0.1, zc, 'concreteTop')
            for k, wx, ww, hh in wins:
                if k == 'win':
                    window_unit(B, wx, y0 + 1.55, zf, ww, hh, trim)
                else:
                    B.plane(ww, hh, wx, y0 + 0.16 + hh / 2, zf - 0.14, 'shutterGrey')
                    for sx2 in (-1, 1):
                        B.box(0.07, hh, 0.1, wx + sx2 * (ww / 2 + 0.035), y0 + 0.16 + hh / 2, zf + 0.02, trim, bevel=0.006)
            if s['balcony']:
                bw = min(3.2, w * 0.5)
                B.box(bw, 0.16, 1.1, x, y0 + 0.08, zf + 0.55, 'concreteTop', bevel=0.015)
                rail = 'paint:#2d2d2b:0.5:0.6'
                B.box(bw, 0.05, 0.05, x, y0 + 1.05, zf + 1.08, rail, bevel=0.01)
                for i in range(int(bw / 0.12) + 1):
                    B.cyl(0.008, 0.9, x - bw / 2 + i * 0.12, y0 + 0.6, zf + 1.08, rail, seg=5)
                for sx2 in (-1, 1):
                    B.box(0.05, 0.05, 1.1, x + sx2 * bw / 2, y0 + 1.05, zf + 0.55, rail)
                    for i in range(9):
                        B.cyl(0.008, 0.9, x + sx2 * bw / 2, y0 + 0.6, zf + i * 0.135, rail, seg=5)
        # bandeaux de dalle
        for f in range(1, F):
            B.box(w + 0.14, 0.22, d + 0.14, x, f * fh, zc, 'concreteTop', bevel=0.02)
    # ---------- toit ----------
    if s['roof'] == 'flat' and not s['unfinished']:
        B.box(w, 0.18, d, x, H + 0.09, zc, 'concreteTop')
        for (px, pz, pw, pd) in [(x, zf - 0.08, w, 0.16), (x, zb + 0.08, w, 0.16), (x - w / 2 + 0.08, zc, 0.16, d), (x + w / 2 - 0.08, zc, 0.16, d)]:
            B.box(pw, 0.75, pd, px, H + 0.55, pz, upper, bevel=0.01)
        B.box(w + 0.08, 0.08, d + 0.08, x, H + 0.96, zc, 'concreteTop', bevel=0.02)  # couronnement
        if s['tank']:
            polytank(B, x + w / 2 - 1, H + 0.18, zb + 1)
    elif s['roof'] == 'tin':
        ov, slope = 0.55, 0.13
        rl = d + ov * 2
        corrugated(B, w + ov * 2, rl / math.cos(slope), x, H + 0.25, zc, slope, 'tin')
        B.box(w + ov * 2, 0.22, 0.04, x, H + 0.25 + math.tan(slope) * rl / 2 - 0.12, zc + rl / 2, 'wood', bevel=0.006)
        B.box(w, 0.6, d, x, H + 0.2, zc, wall, bevel=0.01)
    # descente d'eau pluviale + compteur électrique
    top = H + (0.9 if s['roof'] == 'flat' else 0.3)
    px, pz = x + w / 2 - 0.12, zf + 0.07
    B.cyl(0.045, top, px, top / 2, pz, 'paint:#d8d4ca:0.6:0.1', seg=10)
    for yy in [0.8 + k * 1.6 for k in range(int(top / 1.6))]:
        B.box(0.12, 0.03, 0.08, px, yy, pz - 0.03, 'paint:#8a8a84:0.5:0.6')
    B.cyl(0.045, 0.25, px, 0.1, pz + 0.1, 'paint:#d8d4ca:0.6:0.1', seg=10, axis='Z')  # coude au pied
    B.box(0.32, 0.42, 0.13, x - w / 2 + 0.6, 1.5, zf + 0.06, 'paint:#9a9a92:0.6:0.2', bevel=0.01)
    return B.to_object()


# ---------------------------------------------------------------- UV
def uv_world(ob):
    """UV0 : projection par face selon l'axe dominant, en mètres / échelle de la texture du matériau."""
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    uvl = bm.loops.layers.uv.new('UVMap')
    tiles = [tile_of(m.name) for m in me.materials]
    for f in bm.faces:
        n = f.normal
        a = max(range(3), key=lambda i: abs(n[i]))
        tl = tiles[f.material_index] or 1
        for l in f.loops:
            p = l.vert.co
            u, v = (p.z, p.y) if a == 0 else (p.x, p.z) if a == 1 else (p.x, p.y)
            if a == 0 and n.x < 0: u = -u
            if a == 2 and n.z < 0: u = -u
            l[uvl].uv = (u / tl, v / tl)
    bm.to_mesh(me); bm.free()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    obs = [building(b) for b in SPEC['buildings']]
    for ob in obs:
        uv_world(ob)
    # coordonnées du jeu (y haut) → Blender (z haut) : l'export glTF fera l'inverse
    R = Matrix.Rotation(math.radians(90), 4, 'X')
    for ob in obs:
        ob.data.transform(R)
        ob.data.update()
    # ---------- atlas UV1 commun à tous les bâtiments ----------
    for ob in obs:
        ob.data.uv_layers.new(name='bake')
        ob.data.uv_layers.active = ob.data.uv_layers['bake']
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs: ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002, area_weight=1.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=0.0015, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    # ---------- occultants (non exportés) : sol, trottoir ----------
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0)); ground = bpy.context.active_object
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 5.65, 0.06)); walk = bpy.context.active_object
    walk.scale = (120, 2.65, 0.12); bpy.ops.object.transform_apply(scale=True)
    # ---------- précalcul : R = occlusion ambiante, G = salissure ----------
    img = bpy.data.images.new('rue_lagune_bake', ATLAS, ATLAS, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        if os.environ.get('CYCLES_CPU'):
            raise RuntimeError('CPU demandé')
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for dv in prefs.devices: dv.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('Cycles sur CPU :', e); sc.cycles.device = 'CPU'
    sc.cycles.samples = int(os.environ.get('SAMPLES', 96))
    for m in _mats.values():
        nt = m.node_tree; nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission')
        ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.samples = 24; ao.inputs['Distance'].default_value = 1.4
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Position'], sep.inputs[0])
        # éclaboussures au pied des murs : 1 → 0.62 sur les 70 premiers centimètres
        splash = nt.nodes.new('ShaderNodeMapRange'); splash.inputs['From Min'].default_value = 0.0; splash.inputs['From Max'].default_value = 0.75
        splash.inputs['To Min'].default_value = 0.62; splash.inputs['To Max'].default_value = 1.0; splash.interpolation_type = 'SMOOTHSTEP'
        nt.links.new(sep.outputs['Z'], splash.inputs['Value'])
        # coulures verticales : bruit étiré en hauteur
        mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (7.0, 7.0, 0.35)
        nt.links.new(geo.outputs['Position'], mp.inputs['Vector'])
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1.0; nz.inputs['Detail'].default_value = 6.0
        nt.links.new(mp.outputs[0], nz.inputs['Vector'])
        streak = nt.nodes.new('ShaderNodeMapRange'); streak.inputs['From Min'].default_value = 0.35; streak.inputs['From Max'].default_value = 0.7
        streak.inputs['To Min'].default_value = 0.8; streak.inputs['To Max'].default_value = 1.0
        nt.links.new(nz.outputs['Fac'], streak.inputs['Value'])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
        nt.links.new(splash.outputs['Result'], mul.inputs[0]); nt.links.new(streak.outputs['Result'], mul.inputs[1])
        comb = nt.nodes.new('ShaderNodeCombineXYZ')
        nt.links.new(ao.outputs['AO'], comb.inputs['X']); nt.links.new(mul.outputs[0], comb.inputs['Y'])
        nt.links.new(comb.outputs[0], em.inputs['Color']); nt.links.new(em.outputs[0], out.inputs['Surface'])
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'bake'; nt.links.new(uvn.outputs[0], tex.inputs['Vector'])
        nt.nodes.active = tex
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs: ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    sc.render.bake.margin = 12
    sc.render.bake.use_clear = True
    print('BAKE…', flush=True)
    bpy.ops.object.bake(type='EMIT', margin=12, use_clear=True)
    # léger lissage du bruit (le précalcul n'est pas débruité)
    a = np.array(img.pixels[:], dtype=np.float32).reshape(ATLAS, ATLAS, 4)
    k = np.zeros_like(a)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            k += np.roll(np.roll(a, dy, 0), dx, 1) * (4 if dx == dy == 0 else 2 if dx == 0 or dy == 0 else 1)
    a = k / 16.0; a[..., 3] = 1
    img.pixels[:] = a.reshape(-1)
    img.update()
    print('AO moyen', float(a[..., 0].mean()), 'salissure', float(a[..., 1].mean()))
    # ---------- matériaux d'export : clé du jeu + atlas sur UV1 ----------
    for m in _mats.values():
        nt = m.node_tree; nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'bake'
        nt.links.new(uvn.outputs[0], tex.inputs['Vector']); nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    for ob in obs:
        ob.data.uv_layers.active = ob.data.uv_layers['UVMap']
        ob.data.uv_layers['UVMap'].active_render = True
    bpy.data.objects.remove(ground); bpy.data.objects.remove(walk)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs: ob.select_set(True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_texcoords=True, export_normals=True,
                              export_materials='EXPORT', export_image_format='WEBP', export_image_quality=90, export_yup=True)
    print('EXPORTED', OUT, os.path.getsize(OUT) // 1024, 'Ko', {ob.name: len(ob.data.polygons) for ob in obs})


main()
