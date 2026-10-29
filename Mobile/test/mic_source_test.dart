import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:localsound_mobile/host/mic_source.dart';

/// Bloc mono s16le à partir d'échantillons connus.
Uint8List _mono(List<int> samples) {
  final data = ByteData(samples.length * 2);
  for (var i = 0; i < samples.length; i++) {
    data.setInt16(i * 2, samples[i], Endian.little);
  }
  return data.buffer.asUint8List();
}

void main() {
  test('duplique le micro sur deux canaux', () {
    final stereo = monoStereo(_mono([0, 1000, -2000, 32767, -32768]));
    expect(stereo.length, 5 * 4);
    final view = ByteData.sublistView(stereo);
    expect(
      [for (var i = 0; i < 10; i++) view.getInt16(i * 2, Endian.little)],
      [0, 0, 1000, 1000, -2000, -2000, 32767, 32767, -32768, -32768],
    );
  });

  test('ignore un octet orphelin plutôt que de décaler le flux', () {
    final stereo = monoStereo(Uint8List.fromList([0, 0, 1, 2, 3]));
    expect(stereo.length, 8);
    expect(ByteData.sublistView(stereo).getInt16(4, Endian.little), 0x0201);
  });

  test('mesure un niveau de crête normalisé', () {
    expect(pcmLevel(_mono([0, 0, 0])), 0);
    expect(pcmLevel(_mono([16384, -16384])), closeTo(0.5, 0.001));
    expect(pcmLevel(_mono([-32768])), 1);
    expect(pcmLevel(Uint8List(0)), 0);
  });
}
