import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:localsound_mobile/audio/pcm_encoder.dart';

Float32List _f(List<double> values) => Float32List.fromList(values);

void main() {
  test('entrelace gauche et droite en s16le : G0 D0 G1 D1', () {
    final bytes = interleaveToPcm16(_f([0, 0.5]), _f([-0.5, 0]));
    final samples = Int16List.view(
      bytes.buffer,
      bytes.offsetInBytes,
      bytes.length ~/ 2,
    );
    expect(samples, [0, -16384, 16384, 0]);
    expect(bytes.length, 8);
  });

  test('borne les dépassements et neutralise NaN', () {
    final bytes = interleaveToPcm16(
      _f([2.0, -3.0, double.nan]),
      _f([2.0, -3.0, 0.25]),
    );
    final samples = Int16List.view(
      bytes.buffer,
      bytes.offsetInBytes,
      bytes.length ~/ 2,
    );
    expect(samples[0], 32767);
    expect(samples[2], -32768);
    expect(samples[4], 0);
    expect(samples[5], 8192);
  });

  test('duplique la gauche si la droite est absente', () {
    final bytes = interleaveToPcm16(_f([0.25]), Float32List(0));
    final samples = Int16List.view(
      bytes.buffer,
      bytes.offsetInBytes,
      bytes.length ~/ 2,
    );
    expect(samples.length, 2);
    expect(samples[0], samples[1]);
    expect(samples[0], 8192);
  });

  test('une trame vide ne produit aucun octet', () {
    expect(interleaveToPcm16(Float32List(0), Float32List(0)), isEmpty);
  });

  test('durée d’un bloc 960 échantillons à 48 kHz = 20 ms', () {
    expect(blockDurationMs(960, 48000), 20);
    expect(blockDurationMs(10, 0), 0);
  });
}
