import 'package:flutter/material.dart';

import 'package:localsound_mobile/core/requests.dart';
import 'package:localsound_mobile/room_controller.dart';
import 'package:localsound_mobile/ui/appearance.dart';
import 'package:localsound_mobile/ui/surfaces.dart';

/// File de demandes du salon : on peut proposer un morceau et suivre ce que
/// l'hôte en fait. Les décisions (accepter, refuser) restent sur le PC hôte.
class RequestsScreen extends StatefulWidget {
  const RequestsScreen({super.key, required this.controller});

  final RoomController controller;

  @override
  State<RequestsScreen> createState() => _RequestsScreenState();
}

class _RequestsScreenState extends State<RequestsScreen> {
  final _title = TextEditingController();
  final _url = TextEditingController();
  late final TextEditingController _name = TextEditingController(
    text: widget.controller.listenerName,
  );
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    widget.controller.refreshRequests();
  }

  @override
  void dispose() {
    _title.dispose();
    _url.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_title.text.trim().isEmpty) return;
    setState(() => _sending = true);
    try {
      await widget.controller.submitRequest(title: _title.text, url: _url.text);
      _title.clear();
      _url.clear();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Proposition envoyée. L’hôte choisit la suite.'),
        ),
      );
    } catch (err) {
      if (!mounted) return;
      final message = err.toString().replaceFirst('HttpException: ', '');
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.controller,
      builder: (context, _) {
        final style = RoomStyle.of(
          palette: widget.controller.state.appearance['palette'] as String?,
          isDark: MediaQuery.platformBrightnessOf(context) == Brightness.dark,
        );
        final snapshot = widget.controller.requests;
        final active = snapshot.activeItems;
        final history = snapshot.historyItems;
        return Scaffold(
          body: RoomBackdrop(
            style: style,
            child: SafeArea(
              child: Column(
                children: [
                  _TopBar(
                    style: style,
                    count: snapshot.count,
                    onRefresh: widget.controller.refreshRequests,
                  ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(20, 6, 20, 28),
                      children: [
                        _Form(
                          style: style,
                          title: _title,
                          url: _url,
                          name: _name,
                          sending: _sending,
                          onSubmit: _submit,
                          onName: widget.controller.setListenerName,
                        ),
                        const SizedBox(height: 22),
                        RoomOverline(
                          active.isEmpty
                              ? 'aucune demande en cours'
                              : 'à écouter (${active.length})',
                          style: style,
                        ),
                        const SizedBox(height: 10),
                        if (active.isEmpty)
                          _Empty(style: style)
                        else
                          ...active.map(
                            (item) => _RequestTile(style: style, item: item),
                          ),
                        if (history.isNotEmpty) ...[
                          const SizedBox(height: 22),
                          RoomOverline('historique', style: style),
                          const SizedBox(height: 10),
                          ...history.map(
                            (item) => _RequestTile(
                              style: style,
                              item: item,
                              muted: true,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.style,
    required this.count,
    required this.onRefresh,
  });

  final RoomStyle style;
  final int count;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 10, 18, 10),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Retour au lecteur',
            onPressed: () => Navigator.of(context).maybePop(),
            icon: Icon(Icons.arrow_back_rounded, color: style.text),
          ),
          const SizedBox(width: 2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Demandes',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                    color: style.text,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  'le salon choisit la suite',
                  style: TextStyle(fontSize: 11.5, color: style.muted),
                ),
              ],
            ),
          ),
          if (count > 0) ...[
            RoomPill(label: '$count en cours', color: style.accentText),
            const SizedBox(width: 6),
          ],
          IconButton(
            tooltip: 'Actualiser',
            onPressed: onRefresh,
            icon: Icon(
              Icons.refresh_rounded,
              size: 20,
              color: style.accentText,
            ),
          ),
        ],
      ),
    );
  }
}

class _Form extends StatelessWidget {
  const _Form({
    required this.style,
    required this.title,
    required this.url,
    required this.name,
    required this.sending,
    required this.onSubmit,
    required this.onName,
  });

  final RoomStyle style;
  final TextEditingController title;
  final TextEditingController url;
  final TextEditingController name;
  final bool sending;
  final VoidCallback onSubmit;
  final ValueChanged<String> onName;

  @override
  Widget build(BuildContext context) {
    return RoomCard(
      style: style,
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.queue_music, size: 15, color: style.accentText),
              const SizedBox(width: 8),
              RoomOverline('proposer un morceau', style: style),
            ],
          ),
          const SizedBox(height: 14),
          TextField(
            controller: title,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(
              labelText: 'Titre ou « Artiste - Morceau »',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: url,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Lien (facultatif)',
              hintText: 'https://youtu.be/…',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: name,
            onChanged: onName,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => onSubmit(),
            decoration: const InputDecoration(
              labelText: 'Votre prénom (facultatif)',
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: sending ? null : onSubmit,
            icon: sending
                ? const SizedBox(
                    width: 17,
                    height: 17,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.send_outlined, size: 18),
            label: Text(sending ? 'Envoi…' : 'Envoyer au salon'),
          ),
        ],
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.style});

  final RoomStyle style;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Column(
        children: [
          Icon(
            Icons.playlist_add,
            size: 30,
            color: style.accentText.withValues(alpha: 0.6),
          ),
          const SizedBox(height: 10),
          Text(
            'Le salon se remplit ici, au fil des propositions.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12.5, height: 1.4, color: style.muted),
          ),
        ],
      ),
    );
  }
}

class _RequestTile extends StatelessWidget {
  const _RequestTile({
    required this.style,
    required this.item,
    this.muted = false,
  });

  final RoomStyle style;
  final SongRequest item;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final label = requestStatusLabels[item.status] ?? item.status;
    final badgeColor = switch (item.status) {
      'accepted' => const Color(0xFF3E8E5A),
      'declined' => const Color(0xFF9A4B3D),
      'played' => style.accentText,
      _ => style.accentText,
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: RoomCard(
        style: style,
        padding: const EdgeInsets.fromLTRB(15, 13, 15, 13),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 14.5,
                      height: 1.25,
                      fontWeight: FontWeight.w600,
                      color: muted ? style.muted : style.text,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Proposé par ${item.name}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11.5, color: style.muted),
                  ),
                  if (item.url != null && item.url!.isNotEmpty) ...[
                    const SizedBox(height: 5),
                    Row(
                      children: [
                        Icon(
                          Icons.link,
                          size: 12,
                          color: style.accentText.withValues(alpha: 0.75),
                        ),
                        const SizedBox(width: 5),
                        Expanded(
                          child: Text(
                            item.url!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 11,
                              color: style.accentText.withValues(alpha: 0.9),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 10),
            RoomPill(label: label, color: badgeColor),
          ],
        ),
      ),
    );
  }
}
