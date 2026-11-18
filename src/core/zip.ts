import { crc32 } from './lines/png';

/**
 * A minimal ZIP writer for a PNG sequence: entries are stored, not compressed (a PNG already is), and the
 * time stamp is fixed, so the same frames give the same bytes. Entries are produced one at a time, so a long
 * sequence never has to be held in memory as a whole.
 */
export class ZipWriter {
    private offset = 0;
    private central: Uint8Array[] = [];
    private count = 0;

    /** The bytes of one entry (local header and data) to append to the file. */
    add(name: string, data: Uint8Array): Uint8Array {
        const nameBytes = new TextEncoder().encode(name);
        const crc = (crc32(data) ^ 0xffffffff) >>> 0;
        if (this.offset + 30 + nameBytes.length + data.length > 0xffffffff) throw new Error('The sequence is too big for one ZIP file.');
        const local = new Uint8Array(30 + nameBytes.length + data.length);
        const dv = new DataView(local.buffer);
        dv.setUint32(0, 0x04034b50, true);
        dv.setUint16(4, 20, true);        // version needed
        dv.setUint16(6, 0x0800, true);    // UTF-8 names
        dv.setUint16(8, 0, true);         // stored
        dv.setUint16(10, 0, true);        // time 00:00:00
        dv.setUint16(12, 0x21, true);     // date 1980-01-01
        dv.setUint32(14, crc, true);
        dv.setUint32(18, data.length, true);
        dv.setUint32(22, data.length, true);
        dv.setUint16(26, nameBytes.length, true);
        dv.setUint16(28, 0, true);
        local.set(nameBytes, 30);
        local.set(data, 30 + nameBytes.length);

        const rec = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(rec.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);        // version made by
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0x21, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, this.offset, true);
        rec.set(nameBytes, 46);
        this.central.push(rec);
        this.offset += local.length;
        this.count++;
        return local;
    }

    /** The central directory and the end record: the last bytes of the file. */
    finish(): Uint8Array {
        const size = this.central.reduce((n, r) => n + r.length, 0);
        if (this.count > 0xffff || this.offset + size > 0xffffffff) throw new Error('The sequence is too big for one ZIP file.');
        const out = new Uint8Array(size + 22);
        let o = 0;
        for (const r of this.central) { out.set(r, o); o += r.length; }
        const dv = new DataView(out.buffer);
        dv.setUint32(o, 0x06054b50, true);
        dv.setUint16(o + 8, this.count, true);
        dv.setUint16(o + 10, this.count, true);
        dv.setUint32(o + 12, size, true);
        dv.setUint32(o + 16, this.offset, true);
        return out;
    }
}
