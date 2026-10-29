/// Accès aux fichiers de l'interface web embarqués sous `assets/web/`.
///
/// Ces fichiers sont la copie de `public/` produite par `npm run mobile:web` :
/// le téléphone hôte sert ainsi la même page d'écoute que le PC hôte, sans
/// dépendre d'un ordinateur. La liste vient du manifeste d'assets, donc aucune
/// table de fichiers à tenir à jour.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;

const String webAssetPrefix = 'assets/web/';

/// Extensions servies avec un type MIME explicite : tout le reste répond
/// `application/octet-stream`, jamais deviné par le navigateur.
const Map<String, String> _contentTypes = {
  'html': 'text/html; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  'js': 'text/javascript; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'svg': 'image/svg+xml',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'webp': 'image/webp',
  'ico': 'image/x-icon',
  'woff2': 'font/woff2',
  'txt': 'text/plain; charset=utf-8',
  'md': 'text/plain; charset=utf-8',
};

String contentTypeFor(String path) {
  final dot = path.lastIndexOf('.');
  if (dot < 0 || dot == path.length - 1) return 'application/octet-stream';
  return _contentTypes[path.substring(dot + 1).toLowerCase()] ??
      'application/octet-stream';
}

/// Charge les octets d'un fichier de l'interface, ou `null` s'il n'existe pas.
typedef AssetLoader = Future<Uint8List?> Function(String path);

class WebAssets {
  WebAssets._(this._known);

  final Set<String> _known;

  /// Liste écrite par `npm run mobile:web` : `assets/web_manifest.json`.
  static const String manifestAsset = 'assets/web_manifest.json';

  static Future<WebAssets> load() async {
    final data = await rootBundle.load(manifestAsset);
    final text = utf8.decode(
      data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
    );
    final list = jsonDecode(text);
    final files = list is List ? list.whereType<String>().toSet() : <String>{};
    return WebAssets._(files);
  }

  Iterable<String> get files => _known;

  bool contains(String path) => _known.contains(path);

  Future<Uint8List?> read(String path) async {
    if (!_known.contains(path)) return null;
    final data = await rootBundle.load(webAssetPrefix + path);
    return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
  }
}
