// Loader for the quantized point-cloud data files in src/assets/points/.
//
// Format (.points.b64, plain text so it stays git-friendly):
//   line 1: JSON header {"count":N,"min":[x,y,z],"size":[sx,sy,sz]}
//   rest:   base64 of the binary payload, 9 bytes per point, little-endian:
//           3x uint16 positions quantized over [min, min+size] per axis,
//           then 3x uint8 colors.
// Points were sampled off the surface of the source mesh (area-weighted),
// so the file carries the shape with no triangles, textures, or materials.

export type PointCloudData = {
  positions: Float32Array
  colors: Float32Array
  min: [number, number, number]
  size: [number, number, number]
  count: number
}

type PointsHeader = {
  count: number
  min: [number, number, number]
  size: [number, number, number]
}

function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function parsePointCloud(text: string): PointCloudData {
  const newline = text.indexOf('\n')
  const header = JSON.parse(text.slice(0, newline)) as PointsHeader
  const bytes = decodeBase64(text.slice(newline + 1))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const { count, min, size } = header
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const offset = i * 9
    positions[i * 3] = min[0] + (view.getUint16(offset, true) / 65535) * size[0]
    positions[i * 3 + 1] = min[1] + (view.getUint16(offset + 2, true) / 65535) * size[1]
    positions[i * 3 + 2] = min[2] + (view.getUint16(offset + 4, true) / 65535) * size[2]
    colors[i * 3] = view.getUint8(offset + 6) / 255
    colors[i * 3 + 1] = view.getUint8(offset + 7) / 255
    colors[i * 3 + 2] = view.getUint8(offset + 8) / 255
  }
  return { positions, colors, min, size, count }
}

export async function loadPointCloud(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<PointCloudData> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load point cloud: ${response.status}`)
  const total = Number(response.headers.get('content-length') ?? 0)
  if (!response.body || !total) {
    onProgress?.(1, 1)
    return parsePointCloud(await response.text())
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress?.(loaded, total)
  }
  const merged = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return parsePointCloud(new TextDecoder().decode(merged))
}
