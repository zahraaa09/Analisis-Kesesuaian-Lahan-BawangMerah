from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
import psycopg2.extras
from database import DB_CONFIG, get_db_connection

app = FastAPI(title="SIG Kesesuaian Lahan Bawang Merah")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)


@app.get("/layers")
async def get_layers():
    layers = [
        {"id": "administrasi_wilayah", "name": "Administrasi Wilayah", "type": "polygon", "visible": True},
        {"id": "curah_hujan", "name": "Curah Hujan", "type": "polygon", "visible": False},
        {"id": "kemiringan_lereng", "name": "Kemiringan Lereng", "type": "polygon", "visible": False},
        {"id": "pola_ruang", "name": "Pola Ruang RTRW", "type": "polygon", "visible": False},
        {"id": "tanaman_bawang_merah", "name": "Kesesuaian Bawang Merah", "type": "polygon", "visible": True}
    ]
    return {"status": "success", "data": layers}


@app.get("/layer/{layer_name}/geojson")
async def get_layer_geojson(layer_name: str):
    table_map = {
        "administrasi_wilayah": "administrasi_wilayah",
        "curah_hujan": "curah_hujan",
        "kemiringan_lereng": "kemiringan_lereng",
        "pola_ruang": "pola_ruang",
        "tanaman_bawang_merah": "tanaman_bawang_merah"
    }
    
    if layer_name not in table_map:
        return {"status": "error", "message": "Layer tidak ditemukan"}
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        table = table_map[layer_name]
        query = f"""
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', json_agg(ST_AsGeoJSON(t.*)::json)
        ) as geojson
        FROM (SELECT * FROM {table}) t;
        """
        
        cur.execute(query)
        result = cur.fetchone()[0]
        
        cur.close()
        conn.close()
        
        return result if result else {"type": "FeatureCollection", "features": []}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/suitability")
async def check_suitability(lat: float = Query(...), lon: float = Query(...)):
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        query = """
        WITH titik AS (
            SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS geom
        )
        SELECT 
            w.nama_desa,
            w.kecamatan,
            ch.nilai_curah_hujan,
            kl.kelas_kemiringan,
            pr.zona AS pola_ruang,
            bw.kelas_kesesuaian
        FROM administrasi_wilayah w
        LEFT JOIN curah_hujan ch ON ST_Contains(ch.geom, (SELECT geom FROM titik))
        LEFT JOIN kemiringan_lereng kl ON ST_Contains(kl.geom, (SELECT geom FROM titik))
        LEFT JOIN pola_ruang pr ON ST_Contains(pr.geom, (SELECT geom FROM titik))
        LEFT JOIN tanaman_bawang_merah bw ON ST_Contains(bw.geom, (SELECT geom FROM titik))
        WHERE ST_Contains(w.geom, (SELECT geom FROM titik))
        LIMIT 1
        """
        
        cur.execute(query, (lon, lat))
        result = cur.fetchone()
        
        cur.close()
        conn.close()
        
        if not result:
            return {"status": "error", "message": "Titik di luar wilayah"}
        
        return {"status": "success", "data": dict(result)}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/analyze")
async def analyze_polygon(data: dict):
    try:
        coordinates = data.get("coordinates")
        if not coordinates:
            return {"status": "error", "message": "Koordinat tidak ditemukan"}
        
        coords_list = coordinates[0]
        coords_str = ", ".join([f"{p[0]} {p[1]}" for p in coords_list])
        polygon_wkt = f"POLYGON(({coords_str}))"
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        query = """
        WITH user_polygon AS (
            SELECT ST_SetSRID(ST_GeomFromText(%s), 4326) AS geom
        )
        SELECT 
            kelas_kesesuaian,
            ROUND(SUM(ST_Area(ST_Intersection(bw.geom, up.geom)) * 111319.9 * 111319.9 / 10000)::numeric, 2) AS luas_hektar
        FROM tanaman_bawang_merah bw
        CROSS JOIN user_polygon up
        WHERE ST_Intersects(bw.geom, up.geom)
        GROUP BY kelas_kesesuaian
        """
        
        cur.execute(query, (polygon_wkt,))
        results = cur.fetchall()
        
        cur.close()
        conn.close()
        
        hasil = [{"kelas": r[0], "luas_hektar": r[1]} for r in results]
        
        return {"status": "success", "results": hasil}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/recommendation")
async def get_recommendation(limit: int = 10):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        query = """
        SELECT 
            w.nama_desa,
            bw.kelas_kesesuaian,
            ROUND(SUM(ST_Area(bw.geom) * 111319.9 * 111319.9 / 10000)::numeric, 2) AS luas_total_hektar
        FROM tanaman_bawang_merah bw
        JOIN administrasi_wilayah w ON ST_Intersects(bw.geom, w.geom)
        WHERE bw.kelas_kesesuaian IN ('S1', 'S2')
        GROUP BY w.nama_desa, bw.kelas_kesesuaian
        ORDER BY luas_total_hektar DESC
        LIMIT %s
        """
        
        cur.execute(query, (limit,))
        rows = cur.fetchall()
        
        cur.close()
        conn.close()
        
        if not rows:
            return {"status": "success", "rekomendasi": []}
        
        rekomendasi = []
        for row in rows:
            rekomendasi.append({
                "nama_desa": str(row[0]) if row[0] else "-",
                "kelas_kesesuaian": str(row[1]) if row[1] else "-",
                "luas_total_hektar": float(row[2]) if row[2] else 0.0
            })
        
        return {"status": "success", "rekomendasi": rekomendasi}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("🚀 SIG Bawang Merah API is running!")
    print("📍 URL: http://localhost:8000")
    print("📋 Dokumentasi: http://localhost:8000/docs")
    print("=" * 50)
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)