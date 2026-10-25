# Génère les personnages du jeu (homme / femme) avec MPFB (MakeHuman pour Blender) et la garde-robe CC0 de MakeHuman,
# puis exporte un .glb par sexe dans assets/characters/ :
#   - "Body"   : corps complet skinné (squelette mixamo, compatible avec les animations du jeu),
#                attribut _HIDEBITS : bit i = sommet caché sous le vêtement hideBits[i] (évite que la peau traverse) ;
#   - "Eyes", "Brows", "Lashes", "Teeth" ;
#   - "G_<id>" : chaque vêtement / chaussure (haut et bas des ensembles séparés), même squelette ;
#   - "H_<id>" : chaque coiffure.
# Usage : Blender -b --python build_characters.py -- [m|f|all]
import bpy, bmesh, os, sys, json
import numpy as np
from mathutils import Vector
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.locationservice import LocationService
from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.entities.objectproperties import HumanObjectProperties

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'characters')
U = lambda *p: os.path.join(LocationService.get_user_data(''), *p)

# ensembles MakeHuman → pièces du jeu ; 'split' sépare le haut et le bas (îlots au-dessus / au-dessous de la taille)
SETS = {
    'm': {
        'macro': {"gender": 1.0, "age": 0.43, "muscle": 0.5, "weight": 0.5, "proportions": 0.65, "height": 0.55, "cupsize": 0.5, "firmness": 0.5},
        'skin': 'young_african_male',
        'clothes': [
            ('male_casualsuit06', {'top': 'tee_blanc', 'bottom': 'jean'}),
            ('male_casualsuit04', {'top': 'tee_imprime'}),
            ('male_casualsuit02', {'top': 'manches_longues'}),
            ('male_casualsuit01', {'top': 'chemise_jean'}),
            ('male_casualsuit03', {'top': 'chemise_carreaux'}),
            ('male_casualsuit05', {'top': 'veste'}),
            ('male_elegantsuit01', {'top': 'costume', 'bottom': 'pantalon_costume'}),
            ('male_worksuit01', {'all': 'salopette'}),
            ('shoes05', {'all': 'baskets_blanches'}), ('shoes06', {'all': 'baskets_bleues'}),
            ('shoes02', {'all': 'baskets_sport'}), ('shoes04', {'all': 'chaussures_ville'}), ('shoes01', {'all': 'chaussures_cuir'}),
            ('fedora01', {'all': 'feutre'}),
        ],
        'hair': ['afro01', 'short02', 'short04', 'short01'],
    },
    'f': {
        'macro': {"gender": 0.0, "age": 0.42, "muscle": 0.5, "weight": 0.5, "proportions": 0.65, "height": 0.5, "cupsize": 0.5, "firmness": 0.6},
        'skin': 'young_african_female',
        'clothes': [
            ('female_casualsuit01', {'top': 'tee', 'bottom': 'jean'}),
            ('female_casualsuit02', {'top': 'tee_court', 'bottom': 'short'}),
            ('female_elegantsuit01', {'top': 'chemisier', 'bottom': 'jupe'}),
            ('female_sportsuit01', {'top': 'brassiere', 'bottom': 'legging'}),
            ('shoes05', {'all': 'baskets_blanches'}), ('shoes06', {'all': 'baskets_bleues'}), ('shoes03', {'all': 'bottines'}), ('fedora01', {'all': 'feutre'}),
        ],
        'hair': ['afro01', 'braid01', 'ponytail01', 'bob01', 'long01', 'short02'],
    },
}
# morphes exportés (clés de forme → morph targets glTF) : curseurs de l'éditeur, valeur -1..1 → <id>_moins / <id>_plus
MORPHS = [
    ('width_plus', 't', ['head-scale-horiz-incr']), ('width_moins', 't', ['head-scale-horiz-decr']),
    ('jaw_plus', 't', ['chin-width-incr', 'chin-bones-incr']), ('jaw_moins', 't', ['chin-width-decr', 'chin-bones-decr']),
    ('chin_plus', 't', ['chin-prominent-incr']), ('chin_moins', 't', ['chin-prominent-decr']),
    ('eyes_plus', 't', ['l-eye-scale-incr', 'r-eye-scale-incr']), ('eyes_moins', 't', ['l-eye-scale-decr', 'r-eye-scale-decr']),
    ('nose_plus', 't', ['nose-scale-horiz-incr', 'nose-flaring-incr']), ('nose_moins', 't', ['nose-scale-horiz-decr', 'nose-flaring-decr']),
    ('mouth_plus', 't', ['mouth-scale-horiz-incr']), ('mouth_moins', 't', ['mouth-scale-horiz-decr']),
    ('lips_plus', 't', ['mouth-lowerlip-volume-incr', 'mouth-upperlip-volume-incr']), ('lips_moins', 't', ['mouth-lowerlip-volume-decr', 'mouth-upperlip-volume-decr']),
    ('build_plus', 'macro', ('weight', 0.95)), ('build_moins', 'macro', ('weight', 0.1)),
]
# nettoyage des textures : logo MakeHuman remplacé par du tissu (échantillon répété) puis par notre imprimé
# (x0, y0, x1, y1) en pixels depuis le haut de l'image 2048 ; sample = coin d'un carré de tissu propre ; rot = quarts de tour
RETEX = {
    'male_casualsuit04': [dict(box=(1000, 200, 1305, 505), sample=(1100, 560), print='abidjan225', rot=0)],
    'male_casualsuit02': [dict(box=(1000, 200, 1305, 505), sample=(1100, 560), print='babi', rot=0)],
    'female_casualsuit01': [dict(box=(1450, 295, 1810, 660), sample=(1300, 500), print='abidjan225', rot=-1)],
    'female_casualsuit02': [dict(box=(1450, 295, 1810, 660), sample=(1300, 500), print='babi', rot=-1)],
}
PRINTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prints')
RACE = {"african": 1.0, "asian": 0.0, "caucasian": 0.0}
TEX_MAX = {'Body': 2048}  # résolution max des textures (le reste : 1024)


def mhclo(kind, folder, name=None):
    name = name or folder
    p = U(kind.lower(), folder, name + '.mhclo')
    if not os.path.exists(p):
        raise IOError(p)
    return p


def clean_material(obj, alpha=False):
    """Matériau Principled simple (couleur, normale, alpha) : exporté proprement en glTF."""
    for slot in obj.material_slots:
        m = slot.material
        imgs = [n.image for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeTexImage' and n.image]
        diff = next((i for i in imgs if 'normal' not in i.name.lower() and '_ao' not in i.name.lower() and 'bump' not in i.name.lower()), None)
        nrm = next((i for i in imgs if 'normal' in i.name.lower()), None)
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(bsdf.outputs[0], out.inputs[0])
        bsdf.inputs['Roughness'].default_value = 0.8
        if diff:
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = diff
            nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
            if alpha:
                nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
                m.surface_render_method = 'BLENDED' if hasattr(m, 'surface_render_method') else None
        if nrm:
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = nrm; t.image.colorspace_settings.name = 'Non-Color'
            nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(t.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs[0], bsdf.inputs['Normal'])
        if alpha and hasattr(m, 'blend_method'):
            m.blend_method = 'HASHED'


def retexture(folder):
    if folder not in RETEX:
        return
    img = next((i for i in bpy.data.images if folder in i.name and 'diffuse' in i.name.lower()), None)
    if img is None:
        print('RETEX introuvable', folder); return
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()  # lignes depuis le haut
    for op in RETEX[folder]:
        x0, y0, x1, y1 = op['box']; sx, sy = op['sample']; t = 64
        tile = a[sy:sy + t, sx:sx + t].copy()
        reps = np.tile(tile, ((y1 - y0) // t + 2, (x1 - x0) // t + 2, 1))[:y1 - y0, :x1 - x0]
        # fondu sur les bords pour ne pas voir de cadre
        yy, xx = np.mgrid[0:y1 - y0, 0:x1 - x0]
        edge = np.minimum.reduce([xx, yy, (x1 - x0 - 1) - xx, (y1 - y0 - 1) - yy]).astype(np.float32)
        k = np.clip(edge / 24.0, 0, 1)[..., None]
        a[y0:y1, x0:x1] = a[y0:y1, x0:x1] * (1 - k) + reps * k
        if op.get('print'):
            pi = bpy.data.images.load(os.path.join(PRINTS, op['print'] + '.png'))
            pw, ph = pi.size
            pr = np.array(pi.pixels[:], dtype=np.float32).reshape(ph, pw, 4)[::-1]
            pr = np.rot90(pr, op.get('rot', 0))
            size = int(min(x1 - x0, y1 - y0) * 0.9)
            idx = (np.arange(size) * pr.shape[0] / size).astype(int)
            pr = pr[idx][:, idx]
            cy, cx = (y0 + y1) // 2 - size // 2, (x0 + x1) // 2 - size // 2
            al = pr[..., 3:4]
            # l'imprimé garde le relief du tissu : multiplié par la luminance locale
            lum = a[cy:cy + size, cx:cx + size, :3].mean(axis=2, keepdims=True) / max(1e-3, float(tile[..., :3].mean()))
            a[cy:cy + size, cx:cx + size, :3] = a[cy:cy + size, cx:cx + size, :3] * (1 - al) + np.clip(pr[..., :3] * lum, 0, 1) * al
    img.pixels[:] = a[::-1].reshape(-1)
    img.update()
    print('RETEX', folder)


def shrink_images(limit_default=1024):
    for img in bpy.data.images:
        if img.size[0] == 0:
            continue
        lim = 2048 if 'skin' in img.name.lower() or 'darkskinned' in img.name.lower() or 'african' in img.name.lower() else limit_default
        if max(img.size) > lim:
            k = lim / max(img.size)
            img.scale(int(img.size[0] * k), int(img.size[1] * k))


def select_only(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def split_top_bottom(obj):
    """Sépare un ensemble en îlots ; renvoie (haut, bas) selon la hauteur moyenne de chaque îlot."""
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in bpy.context.selected_objects]
    zs = [sum((o.matrix_world @ v.co).z for v in o.data.vertices) / len(o.data.vertices) for o in parts]
    waist = 0.98  # mètres (pose de repos)
    top = [o for o, z in zip(parts, zs) if z > waist]; bot = [o for o, z in zip(parts, zs) if z <= waist]
    if not top or not bot:
        # maillage d'un seul tenant (chemise rentrée dans le pantalon) : découpe des faces à la ceinture
        big = max(parts, key=lambda o: len(o.data.vertices)); select_only(big)
        cut = waist + 0.04
        for poly in big.data.polygons: poly.select = (big.matrix_world @ poly.center).z > cut
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
        new = [o for o in bpy.context.selected_objects if o is not big]
        top, bot = (top or new), (bot or [big]) if not top else ([big] if not bot else bot)
        if top is new: bot = [o for o in parts if o not in top]
    def join(lst):
        if not lst:
            return None
        bpy.ops.object.select_all(action='DESELECT')
        for o in lst: o.select_set(True)
        bpy.context.view_layer.objects.active = lst[0]
        if len(lst) > 1: bpy.ops.object.join()
        return bpy.context.view_layer.objects.active
    return join(top), join(bot)


def build(sex):
    S = SETS[sex]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    macro = dict(S['macro']); macro['race'] = RACE
    body = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    rig = HumanService.add_builtin_rig(body, 'mixamo')
    HumanService.set_character_skin(U('skins', S['skin'], S['skin'] + '.mhmat'), body, skin_type='GAMEENGINE')
    extras = {}
    for name, (kind, folder, file) in {'Eyes': ('Eyes', 'low-poly', None), 'Brows': ('Eyebrows', 'eyebrow001', None),
                                       'Lashes': ('Eyelashes', 'eyelashes01', None), 'Teeth': ('Teeth', 'teeth_base', None)}.items():
        try:
            o = HumanService.add_mhclo_asset(mhclo(kind, folder, file), body, asset_type=kind, subdiv_levels=0, material_type='MAKESKIN')
            o.name = name; extras[name] = o
        except Exception as e:
            print('SKIP', name, e)
    raw = []  # (dossier, pièces, objet) — ensembles entiers pendant la capture des morphes
    for folder, parts in S['clothes']:
        o = HumanService.add_mhclo_asset(mhclo('Clothes', folder), body, asset_type='Clothes', subdiv_levels=0, material_type='MAKESKIN')
        grp = next((m.vertex_group for m in body.modifiers if m.type == 'MASK' and m.vertex_group.endswith(folder)), None)
        raw.append((folder, parts, o, grp))
    hairs = {}
    for h in S['hair']:
        o = HumanService.add_mhclo_asset(mhclo('Hair', h), body, asset_type='Hair', subdiv_levels=0, material_type='MAKESKIN')
        o.name = 'H_' + h; hairs[h] = o

    # ---- morphes (curseurs visage / corpulence) : cible appliquée au corps, vêtements réajustés, écarts enregistrés ----
    assets = [*extras.values(), *[r[2] for r in raw], *hairs.values()]
    def body_co():
        k = body.shape_key_add(name='tmp_mix', from_mix=True)
        co = np.empty(len(k.data) * 3, dtype=np.float32); k.data.foreach_get('co', co)
        body.shape_key_remove(k)
        return co
    def obj_co(o):
        co = np.empty(len(o.data.vertices) * 3, dtype=np.float32); o.data.vertices.foreach_get('co', co); return co
    def refit():
        for o in assets: ClothesService.fit_clothes_to_human(o, body)
    TARGETS = {f[:-10]: os.path.join(dp, f) for dp, _, fs in os.walk(LocationService.get_mpfb_data('targets')) for f in fs if f.endswith('.target.gz')}
    base = {'Body': body_co(), **{o.name: obj_co(o) for o in assets}}
    deltas = {}  # nom du morphe → {objet: écart}
    for mname, kind, spec in MORPHS:
        before = set(k.name for k in body.data.shape_keys.key_blocks)
        if kind == 'macro':
            old = HumanObjectProperties.get_value(spec[0], entity_reference=body)
            HumanObjectProperties.set_value(spec[0], spec[1], entity_reference=body); TargetService.reapply_macro_details(body)
        else:
            for t in spec:
                TargetService.load_target(body, TARGETS[t], weight=1.0, name='m_' + t)
        refit()
        cur = {'Body': body_co(), **{o.name: obj_co(o) for o in assets}}
        deltas[mname] = {k: cur[k] - base[k] for k in cur if np.abs(cur[k] - base[k]).max() > 1e-5}
        if kind == 'macro':
            HumanObjectProperties.set_value(spec[0], old, entity_reference=body); TargetService.reapply_macro_details(body)
        else:
            for k in [k for k in body.data.shape_keys.key_blocks if k.name not in before]: body.shape_key_remove(k)
        print('MORPH', mname, {k: round(float(np.abs(v).max()), 4) for k, v in deltas[mname].items()})
    refit()
    def add_keys(o, name):
        for mname, d in deltas.items():
            if name not in d: continue
            if not o.data.shape_keys: o.shape_key_add(name='Basis', from_mix=False)
            k = o.shape_key_add(name=mname, from_mix=False)
            co = np.empty(len(k.data) * 3, dtype=np.float32); k.data.foreach_get('co', co)
            k.data.foreach_set('co', co + d[name]); k.value = 0.0
    for o in assets: add_keys(o, o.name)

    # ---- ensembles : séparation haut / bas (les clés de forme suivent) ----
    garments = {}  # id → objet
    hide_groups = {}  # id → (nom du groupe Delete sur le corps, filtre en z)
    for folder, parts, o, grp in raw:
        if 'all' in parts:
            o.name = 'G_' + parts['all']; garments[parts['all']] = o; hide_groups[parts['all']] = (grp, None)
            continue
        top, bot = split_top_bottom(o)
        print('SPLIT', folder, top and top.name, bot and bot.name)
        for key, part in (('top', top), ('bottom', bot)):
            if not part:
                continue
            if key in parts:
                part.name = 'G_' + parts[key]; garments[parts[key]] = part
                zs = [(part.matrix_world @ v.co).z for v in part.data.vertices]
                hide_groups[parts[key]] = (grp, ('above', min(zs) + 0.03) if key == 'top' else ('below', max(zs) - 0.03))
            else:
                bpy.data.objects.remove(part)  # bas en double (jean identique d'un ensemble à l'autre)

    # ---- corps : formes figées, morphes en clés de forme, géométrie d'aide supprimée, masques → attributs ----
    select_only(body)
    if body.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    add_keys(body, 'Body')
    me = body.data
    gi = {g.name: g.index for g in body.vertex_groups}
    def in_group(v, name):
        if name not in gi: return 0.0
        for g in v.groups:
            if g.group == gi[name]: return g.weight
        return 0.0
    hide = {gid: [0.0] * len(me.vertices) for gid in hide_groups}
    for v in me.vertices:
        z = (body.matrix_world @ v.co).z
        for gid, (grp, filt) in hide_groups.items():
            if grp and in_group(v, grp) > 0.5:
                if filt is None or (filt[0] == 'above' and z > filt[1]) or (filt[0] == 'below' and z < filt[1]):
                    hide[gid][v.index] = 1.0
    # un seul attribut : bit i = caché sous le vêtement i (WebGL limite le nombre d'attributs par sommet)
    bits = sorted(hide)
    packed = [float(sum((1 << i) for i, gid in enumerate(bits) if hide[gid][k] > 0.5)) for k in range(len(me.vertices))]
    a = me.attributes.new('_HIDEBITS', 'FLOAT', 'POINT')
    a.data.foreach_set('value', packed)
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    deform = bm.verts.layers.deform.active
    bodyi = gi['body']
    kill = [bv for bv in bm.verts if bodyi not in bv[deform] or bv[deform][bodyi] < 0.5]
    bmesh.ops.delete(bm, geom=kill, context='VERTS'); bm.to_mesh(me); bm.free()
    for m in list(body.modifiers):
        if m.type == 'MASK': body.modifiers.remove(m)
    for g in list(body.vertex_groups):  # seuls les os du squelette restent
        if not g.name.startswith('mixamorig:'): body.vertex_groups.remove(g)
    body.name = 'Body'

    # ---- matériaux ----
    clean_material(body)
    for n, o in extras.items(): clean_material(o, alpha=n in ('Brows', 'Lashes'))
    for o in garments.values(): clean_material(o)
    for folder, _, _, _ in raw: retexture(folder)
    for o in hairs.values(): clean_material(o, alpha=True)
    shrink_images()

    # ---- avatar nu pour Marvelous Designer (coudre de nouveaux vêtements à la bonne taille) ----
    md = os.path.join(ROOT, 'tools', 'marvelous'); os.makedirs(md, exist_ok=True)
    select_only(body)
    bpy.ops.wm.obj_export(filepath=os.path.join(md, 'avatar_' + sex + '.obj'), export_selected_objects=True, export_materials=False,
                          export_uv=True, export_normals=True, apply_modifiers=False, forward_axis='NEGATIVE_Z', up_axis='Y')

    # ---- export ----
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'babi_' + sex + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for o in [body, *extras.values(), *garments.values(), *hairs.values()]: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_skins=True,
                              export_animations=False, export_morph=True, export_morph_normal=False, export_attributes=True, export_image_format='WEBP',
                              export_image_quality=85, export_yup=True)
    meta = {'morphs': [m[0] for m in MORPHS], 'hideBits': bits, 'garments': sorted(garments), 'hairs': sorted(hairs), 'verts': {o.name: len(o.data.vertices) for o in [body, *garments.values(), *hairs.values()]}}
    with open(os.path.join(OUT, 'babi_' + sex + '.json'), 'w') as f: json.dump(meta, f, indent=1, ensure_ascii=False)
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'Ko', json.dumps(meta))


arg = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'all'
for sx in (['m', 'f'] if arg == 'all' else [arg]):
    build(sx)
