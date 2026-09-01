//! `Math.sin` / `Math.cos` exactly as V8 computes them in Node: the fdlibm
//! `sin`/`cos` from `src/base/ieee754.cc` (`__kernel_sin`, `__kernel_cos`,
//! `__ieee754_rem_pio2`, `__kernel_rem_pio2`). Node's V8 is built without
//! `V8_USE_LIBM_TRIG_FUNCTIONS`, so this is the code path behind `Math.sin`.
//! Platform libms differ from it in the last bit on a few percent of inputs.
//!
//! JS-PARITY: V8 compiles this C with clang, whose default `-ffp-contract=on`
//! fuses `a * b + c` into FMA on arm64 builds. Node on Apple Silicon therefore
//! returns a value one ulp away from this port for roughly 0.5% of arguments
//! (Node on x86-64 matches it exactly). No recorded vector distinguishes the
//! two, and every consumer rounds the result to an 8-bit channel.
//!
//! Original: Copyright (C) 1993 by Sun Microsystems, Inc. (fdlibm), as
//! carried in V8 under the V8 license.

#![allow(clippy::excessive_precision)]

#[inline]
fn high_word(d: f64) -> i32 {
    (d.to_bits() >> 32) as u32 as i32
}
#[inline]
fn low_word(d: f64) -> u32 {
    (d.to_bits() & 0xFFFF_FFFF) as u32
}
#[inline]
fn insert_words(hi: i32, lo: u32) -> f64 {
    f64::from_bits(((hi as u32 as u64) << 32) | lo as u64)
}
#[inline]
fn set_high_word(d: f64, hi: i32) -> f64 {
    insert_words(hi, low_word(d))
}
#[inline]
fn set_low_word(d: f64, lo: u32) -> f64 {
    insert_words(high_word(d), lo)
}

/// fdlibm `scalbn`: x × 2^n.
pub fn scalbn(x: f64, n: i32) -> f64 {
    const TWO54: f64 = 1.80143985094819840000e+16;
    const TWOM54: f64 = 5.55111512312578270212e-17;
    const HUGE: f64 = 1.0e300;
    const TINY: f64 = 1.0e-300;
    let mut x = x;
    let mut hx = high_word(x);
    let lx = low_word(x);
    let mut k = (hx & 0x7ff00000) >> 20;
    if k == 0 {
        if (lx | (hx & 0x7fffffff) as u32) == 0 {
            return x;
        }
        x *= TWO54;
        hx = high_word(x);
        k = ((hx & 0x7ff00000) >> 20) - 54;
        if n < -50000 {
            return TINY * x;
        }
    }
    if k == 0x7ff {
        return x + x;
    }
    k += n;
    if k > 0x7fe {
        return HUGE * if x < 0.0 { -HUGE } else { HUGE };
    }
    if k > 0 {
        return set_high_word(x, (hx & 0x800fffff_u32 as i32) | (k << 20));
    }
    if k <= -54 {
        if n > 50000 {
            return HUGE * if x < 0.0 { -HUGE } else { HUGE };
        }
        return TINY * if x < 0.0 { -TINY } else { TINY };
    }
    k += 54;
    x = set_high_word(x, (hx & 0x800fffff_u32 as i32) | (k << 20));
    x * TWOM54
}

const TWO_OVER_PI: [i32; 66] = [
    0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C, 0x439041, 0xFE5163,
    0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129,
    0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C,
    0x845F8B, 0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
    0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5, 0xF17B3D, 0x0739F7, 0x8A5292,
    0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3,
    0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA,
    0x73A8C9, 0x60E27B, 0xC08C6B,
];

const NPIO2_HW: [i32; 32] = [
    0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB,
    0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB,
    0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
    0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
];

/// fdlibm `__kernel_rem_pio2`.
fn kernel_rem_pio2(
    x: &[f64],
    y: &mut [f64; 3],
    e0: i32,
    nx: i32,
    prec: usize,
    ipio2: &[i32],
) -> i32 {
    const INIT_JK: [i32; 4] = [2, 3, 4, 6];
    const PIO2: [f64; 8] = [
        1.57079625129699707031e+00,
        7.54978941586159635335e-08,
        5.39030252995776476554e-15,
        3.28200341580791294123e-22,
        1.27065575308067607349e-29,
        1.22933308981111328932e-36,
        2.73370053816464559624e-44,
        2.16741683877804819444e-51,
    ];
    const ZERO: f64 = 0.0;
    const ONE: f64 = 1.0;
    const TWO24: f64 = 1.67772160000000000000e+07;
    const TWON24: f64 = 5.96046447753906250000e-08;

    let mut iq = [0i32; 20];
    let mut f = [0f64; 20];
    let mut fq = [0f64; 20];
    let mut q = [0f64; 20];

    let jk = INIT_JK[prec];
    let jp = jk;
    let jx = nx - 1;
    let mut jv = (e0 - 3) / 24;
    if jv < 0 {
        jv = 0;
    }
    let mut q0 = e0 - 24 * (jv + 1);

    let mut j = jv - jx;
    let m = jx + jk;
    for i in 0..=m {
        f[i as usize] = if j < 0 {
            ZERO
        } else {
            ipio2[j as usize] as f64
        };
        j += 1;
    }
    for i in 0..=jk {
        let mut fw = 0.0;
        for j in 0..=jx {
            fw += x[j as usize] * f[(jx + i - j) as usize];
        }
        q[i as usize] = fw;
    }

    let mut jz = jk;
    let mut z;
    let mut n;
    let mut ih;
    loop {
        // recompute:
        let mut i = 0i32;
        let mut jj = jz;
        z = q[jz as usize];
        while jj > 0 {
            let fw = (TWON24 * z) as i32 as f64;
            iq[i as usize] = (z - TWO24 * fw) as i32;
            z = q[(jj - 1) as usize] + fw;
            i += 1;
            jj -= 1;
        }
        z = scalbn(z, q0);
        z -= 8.0 * (z * 0.125).floor();
        n = z as i32;
        z -= n as f64;
        ih = 0;
        if q0 > 0 {
            let i2 = iq[(jz - 1) as usize] >> (24 - q0);
            n += i2;
            iq[(jz - 1) as usize] -= i2 << (24 - q0);
            ih = iq[(jz - 1) as usize] >> (23 - q0);
        } else if q0 == 0 {
            ih = iq[(jz - 1) as usize] >> 23;
        } else if z >= 0.5 {
            ih = 2;
        }
        if ih > 0 {
            n += 1;
            let mut carry = 0;
            for i in 0..jz {
                let j = iq[i as usize];
                if carry == 0 {
                    if j != 0 {
                        carry = 1;
                        iq[i as usize] = 0x1000000 - j;
                    }
                } else {
                    iq[i as usize] = 0xFFFFFF - j;
                }
            }
            if q0 > 0 {
                match q0 {
                    1 => iq[(jz - 1) as usize] &= 0x7FFFFF,
                    2 => iq[(jz - 1) as usize] &= 0x3FFFFF,
                    _ => {}
                }
            }
            if ih == 2 {
                z = ONE - z;
                if carry != 0 {
                    z -= scalbn(ONE, q0);
                }
            }
        }
        if z == ZERO {
            let mut j = 0;
            let mut i = jz - 1;
            while i >= jk {
                j |= iq[i as usize];
                i -= 1;
            }
            if j == 0 {
                let mut k = 1;
                while jk >= k && iq[(jk - k) as usize] == 0 {
                    k += 1;
                }
                for i in (jz + 1)..=(jz + k) {
                    f[(jx + i) as usize] = ipio2[(jv + i) as usize] as f64;
                    let mut fw = 0.0;
                    for j in 0..=jx {
                        fw += x[j as usize] * f[(jx + i - j) as usize];
                    }
                    q[i as usize] = fw;
                }
                jz += k;
                continue;
            }
        }
        break;
    }

    if z == 0.0 {
        jz -= 1;
        q0 -= 24;
        while iq[jz as usize] == 0 {
            jz -= 1;
            q0 -= 24;
        }
    } else {
        z = scalbn(z, -q0);
        if z >= TWO24 {
            let fw = (TWON24 * z) as i32 as f64;
            iq[jz as usize] = (z - TWO24 * fw) as i32;
            jz += 1;
            q0 += 24;
            iq[jz as usize] = fw as i32;
        } else {
            iq[jz as usize] = z as i32;
        }
    }

    let mut fw = scalbn(ONE, q0);
    let mut i = jz;
    while i >= 0 {
        q[i as usize] = fw * iq[i as usize] as f64;
        fw *= TWON24;
        i -= 1;
    }

    let mut i = jz;
    while i >= 0 {
        let mut fw = 0.0;
        let mut k = 0;
        while k <= jp && k <= jz - i {
            fw += PIO2[k as usize] * q[(i + k) as usize];
            k += 1;
        }
        fq[(jz - i) as usize] = fw;
        i -= 1;
    }

    match prec {
        0 => {
            let mut fw = 0.0;
            let mut i = jz;
            while i >= 0 {
                fw += fq[i as usize];
                i -= 1;
            }
            y[0] = if ih == 0 { fw } else { -fw };
        }
        1 | 2 => {
            let mut fw = 0.0;
            let mut i = jz;
            while i >= 0 {
                fw += fq[i as usize];
                i -= 1;
            }
            y[0] = if ih == 0 { fw } else { -fw };
            let mut fw = fq[0] - fw;
            for i in 1..=jz {
                fw += fq[i as usize];
            }
            y[1] = if ih == 0 { fw } else { -fw };
        }
        _ => {
            let mut i = jz;
            while i > 0 {
                let fw = fq[(i - 1) as usize] + fq[i as usize];
                fq[i as usize] += fq[(i - 1) as usize] - fw;
                fq[(i - 1) as usize] = fw;
                i -= 1;
            }
            let mut i = jz;
            while i > 1 {
                let fw = fq[(i - 1) as usize] + fq[i as usize];
                fq[i as usize] += fq[(i - 1) as usize] - fw;
                fq[(i - 1) as usize] = fw;
                i -= 1;
            }
            let mut fw = 0.0;
            let mut i = jz;
            while i >= 2 {
                fw += fq[i as usize];
                i -= 1;
            }
            if ih == 0 {
                y[0] = fq[0];
                y[1] = fq[1];
                y[2] = fw;
            } else {
                y[0] = -fq[0];
                y[1] = -fq[1];
                y[2] = -fw;
            }
        }
    }
    n & 7
}

/// fdlibm `__ieee754_rem_pio2` (the original fdlibm shape with the
/// `npio2_hw` table, as V8 carries it).
fn rem_pio2(x: f64, y: &mut [f64; 2]) -> i32 {
    const ZERO: f64 = 0.0;
    const HALF: f64 = 0.5;
    const TWO24: f64 = 1.67772160000000000000e+07;
    const INVPIO2: f64 = 6.36619772367581382433e-01;
    const PIO2_1: f64 = 1.57079632673412561417e+00;
    const PIO2_1T: f64 = 6.07710050650619224932e-11;
    const PIO2_2: f64 = 6.07710050630396597660e-11;
    const PIO2_2T: f64 = 2.02226624879595063154e-21;
    const PIO2_3: f64 = 2.02226624871116645580e-21;
    const PIO2_3T: f64 = 8.47842766036889956997e-32;

    let hx = high_word(x);
    let ix = hx & 0x7FFFFFFF;
    if ix <= 0x3FE921FB {
        y[0] = x;
        y[1] = 0.0;
        return 0;
    }
    if ix < 0x4002D97C {
        if hx > 0 {
            let mut z = x - PIO2_1;
            if ix != 0x3FF921FB {
                y[0] = z - PIO2_1T;
                y[1] = (z - y[0]) - PIO2_1T;
            } else {
                z -= PIO2_2;
                y[0] = z - PIO2_2T;
                y[1] = (z - y[0]) - PIO2_2T;
            }
            return 1;
        } else {
            let mut z = x + PIO2_1;
            if ix != 0x3FF921FB {
                y[0] = z + PIO2_1T;
                y[1] = (z - y[0]) + PIO2_1T;
            } else {
                z += PIO2_2;
                y[0] = z + PIO2_2T;
                y[1] = (z - y[0]) + PIO2_2T;
            }
            return -1;
        }
    }
    if ix <= 0x413921FB {
        let mut t = x.abs();
        let n = (t * INVPIO2 + HALF) as i32;
        let fn_ = n as f64;
        let mut r = t - fn_ * PIO2_1;
        let mut w = fn_ * PIO2_1T;
        if n < 32 && ix != NPIO2_HW[(n - 1) as usize] {
            y[0] = r - w;
        } else {
            let j = ix >> 20;
            y[0] = r - w;
            let high = high_word(y[0]);
            let mut i = j - ((high >> 20) & 0x7FF);
            if i > 16 {
                t = r;
                w = fn_ * PIO2_2;
                r = t - w;
                w = fn_ * PIO2_2T - ((t - r) - w);
                y[0] = r - w;
                let high = high_word(y[0]);
                i = j - ((high >> 20) & 0x7FF);
                if i > 49 {
                    t = r;
                    w = fn_ * PIO2_3;
                    r = t - w;
                    w = fn_ * PIO2_3T - ((t - r) - w);
                    y[0] = r - w;
                }
            }
        }
        y[1] = (r - y[0]) - w;
        if hx < 0 {
            y[0] = -y[0];
            y[1] = -y[1];
            return -n;
        }
        return n;
    }
    if ix >= 0x7FF00000 {
        y[0] = x - x;
        y[1] = y[0];
        return 0;
    }
    let low = low_word(x);
    let mut z = set_low_word(0.0, low);
    let e0 = (ix >> 20) - 1046;
    z = set_high_word(z, ix - (((e0 as u32) << 20) as i32));
    let mut tx = [0f64; 3];
    for item in tx.iter_mut().take(2) {
        *item = (z as i32) as f64;
        z = (z - *item) * TWO24;
    }
    tx[2] = z;
    let mut nx = 3;
    while tx[(nx - 1) as usize] == ZERO {
        nx -= 1;
    }
    let mut yy = [0f64; 3];
    let n = kernel_rem_pio2(&tx, &mut yy, e0, nx, 2, &TWO_OVER_PI);
    y[0] = yy[0];
    y[1] = yy[1];
    if hx < 0 {
        y[0] = -y[0];
        y[1] = -y[1];
        return -n;
    }
    n
}

/// fdlibm `__kernel_cos`.
fn kernel_cos(x: f64, y: f64) -> f64 {
    const ONE: f64 = 1.0;
    const C1: f64 = 4.16666666666666019037e-02;
    const C2: f64 = -1.38888888888741095749e-03;
    const C3: f64 = 2.48015872894767294178e-05;
    const C4: f64 = -2.75573143513906633035e-07;
    const C5: f64 = 2.08757232129817482790e-09;
    const C6: f64 = -1.13596475577881948265e-11;
    let ix = high_word(x) & 0x7FFFFFFF;
    if ix < 0x3E400000 && (x as i32) == 0 {
        return ONE;
    }
    let z = x * x;
    let r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    if ix < 0x3FD33333 {
        ONE - (0.5 * z - (z * r - x * y))
    } else {
        let qx = if ix > 0x3FE90000 {
            0.28125
        } else {
            insert_words(ix - 0x00200000, 0)
        };
        let iz = 0.5 * z - qx;
        let a = ONE - qx;
        a - (iz - (z * r - x * y))
    }
}

/// fdlibm `__kernel_sin`.
fn kernel_sin(x: f64, y: f64, iy: i32) -> f64 {
    const HALF: f64 = 0.5;
    const S1: f64 = -1.66666666666666324348e-01;
    const S2: f64 = 8.33333333332248946124e-03;
    const S3: f64 = -1.98412698298579493134e-04;
    const S4: f64 = 2.75573137070700676789e-06;
    const S5: f64 = -2.50507602534068634195e-08;
    const S6: f64 = 1.58969099521155010221e-10;
    let ix = high_word(x) & 0x7FFFFFFF;
    if ix < 0x3E400000 && (x as i32) == 0 {
        return x;
    }
    let z = x * x;
    let v = z * x;
    let r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    if iy == 0 {
        x + v * (S1 + z * r)
    } else {
        x - ((z * (HALF * y - v * r) - y) - v * S1)
    }
}

/// fdlibm `sin`.
pub fn fdlibm_sin(x: f64) -> f64 {
    let ix = high_word(x) & 0x7FFFFFFF;
    if ix <= 0x3FE921FB {
        return kernel_sin(x, 0.0, 0);
    }
    if ix >= 0x7FF00000 {
        return x - x;
    }
    let mut y = [0f64; 2];
    let n = rem_pio2(x, &mut y);
    match n & 3 {
        0 => kernel_sin(y[0], y[1], 1),
        1 => kernel_cos(y[0], y[1]),
        2 => -kernel_sin(y[0], y[1], 1),
        _ => -kernel_cos(y[0], y[1]),
    }
}

/// fdlibm `cos`.
pub fn fdlibm_cos(x: f64) -> f64 {
    let ix = high_word(x) & 0x7FFFFFFF;
    if ix <= 0x3FE921FB {
        return kernel_cos(x, 0.0);
    }
    if ix >= 0x7FF00000 {
        return x - x;
    }
    let mut y = [0f64; 2];
    let n = rem_pio2(x, &mut y);
    match n & 3 {
        0 => kernel_cos(y[0], y[1]),
        1 => -kernel_sin(y[0], y[1], 1),
        2 => -kernel_cos(y[0], y[1]),
        _ => kernel_sin(y[0], y[1], 1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke() {
        assert_eq!(fdlibm_sin(0.0), 0.0);
        assert_eq!(fdlibm_cos(0.0), 1.0);
        assert!((fdlibm_sin(std::f64::consts::FRAC_PI_2) - 1.0).abs() < 1e-15);
        assert!((fdlibm_cos(std::f64::consts::PI) + 1.0).abs() < 1e-15);
        assert!((fdlibm_sin(1e10) - (1e10f64).sin()).abs() < 1e-9);
        assert!((fdlibm_cos(1e22) - (1e22f64).cos()).abs() < 1e-9);
        assert!((fdlibm_sin(-3.0) - (-3.0f64).sin()).abs() < 1e-15);
        assert!(fdlibm_sin(f64::INFINITY).is_nan());
        assert!(fdlibm_cos(f64::NAN).is_nan());
    }
}
