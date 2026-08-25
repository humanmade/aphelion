// Deterministic external-driver fixtures. These model what an MCP client,
// WP-CLI process, REST client, or wp-admin browser causes WordPress to emit;
// Aphelion itself never performs the represented mutations.

const target = 'http://localhost:8081'

const event = (source, kind, ts, data, receivedAt = ts) => ({
  v: 1,
  seq: 0,
  ts,
  ...(receivedAt !== ts ? { receivedAt } : {}),
  source,
  kind,
  data: { site: target, ...data },
})

export const wordpressJourneys = {
  blockPageEdit: {
    id: 'wp-block-page-edit',
    target,
    description: 'MCP-declared page edit observed through the WordPress REST save path',
    events: [
      event('mcp', 'presence.ready', 1_000, {
        connectionId: 'mcp-block-1', requestId: 'block-edit-1', actor: 'qa-agent',
        channel: 'mcp', transport: 'stdio',
      }),
      event('mcp', 'mcp.ability.call', 1_010, {
        requestId: 'block-edit-1', ability: 'wordpress/edit-page', tool: 'mcp__wordpress__edit_page',
        channel: 'mcp', transport: 'stdio', objectType: 'page', objectId: 301,
        summary: 'Edit the aphelion-test landing page',
      }),
      event('wp', 'presence.open', 1_050, {
        connectionId: 'rest-block-1', requestId: 'block-edit-1', actor: { login: 'qa-agent' },
        channel: 'rest', transport: 'docker-network',
      }, 1_062),
      event('wp', 'wp.rest.write', 1_110, {
        requestId: 'block-edit-1', route: '/wp/v2/pages/301', method: 'POST', status: 200,
        channel: 'rest', transport: 'docker-network', objectType: 'page', objectId: 301,
      }, 1_124),
      event('wp', 'wp.post.updated', 1_145, {
        requestId: 'block-edit-1', objectType: 'post', objectId: 301, postType: 'page',
        title: 'aphelion-test-landing', status: 'draft', channel: 'rest', transport: 'docker-network',
        changedProperties: ['content'],
        blocks: ['core/group', 'core/heading', 'core/paragraph', 'core/image'],
        blockCount: 4,
        uniqueBlockCount: 4,
        blockChanges: [
          { path: '0.0', name: 'core/paragraph', change: 'updated', properties: ['content'] },
          { path: '0.1', name: 'core/image', change: 'added', properties: ['url', 'alt'] },
        ],
        summary: 'Updated the aphelion-test landing page blocks',
      }, 1_152),
      event('wp', 'presence.close', 1_180, {
        connectionId: 'rest-block-1', requestId: 'block-edit-1', channel: 'rest', transport: 'docker-network',
      }),
      event('mcp', 'presence.close', 1_195, {
        connectionId: 'mcp-block-1', requestId: 'block-edit-1', channel: 'mcp', transport: 'stdio',
      }),
    ],
  },

  settingsRestore: {
    id: 'wp-settings-restore',
    target,
    description: 'WP-CLI changes one low-impact setting and restores its prior state',
    events: [
      event('cli', 'agent.action.declared', 2_000, {
        requestId: 'settings-1', action: 'update-setting', name: 'aphelion_test_show_on_front',
        channel: 'wp-cli', transport: 'docker-exec', summary: 'Change a presentation setting',
      }),
      event('cli', 'presence.open', 2_020, {
        connectionId: 'cli-settings-1', requestId: 'settings-1', channel: 'wp-cli', transport: 'docker-exec',
      }),
      event('cli', 'presence.ready', 2_030, {
        connectionId: 'cli-settings-1', requestId: 'settings-1', channel: 'wp-cli', transport: 'docker-exec',
      }),
      event('wp', 'wp.option.updated', 2_080, {
        requestId: 'settings-1', objectType: 'option', name: 'aphelion_test_show_on_front', changed: true,
        beforeType: 'string', afterType: 'string', channel: 'wp-cli', transport: 'docker-exec',
        summary: 'WordPress setting aphelion_test_show_on_front changed',
      }),
      event('wp', 'wp.option.updated', 2_180, {
        requestId: 'settings-1', objectType: 'option', name: 'aphelion_test_show_on_front', changed: true,
        beforeType: 'string', afterType: 'string', channel: 'wp-cli', transport: 'docker-exec',
        restored: true, summary: 'Restored WordPress setting aphelion_test_show_on_front',
      }),
      event('cli', 'presence.close', 2_220, {
        connectionId: 'cli-settings-1', requestId: 'settings-1', channel: 'wp-cli', transport: 'docker-exec',
      }),
    ],
  },

  yoastMetadata: {
    id: 'wp-yoast-metadata',
    target,
    description: 'REST-edited page metadata retains plugin ownership without storing the value',
    events: [
      event('hook', 'agent.action.declared', 3_000, {
        requestId: 'yoast-1', action: 'set-post-metadata', objectType: 'page', objectId: 301,
        metaKey: '_yoast_wpseo_title', channel: 'rest', transport: 'http',
        summary: 'Update SEO metadata for the aphelion-test landing page',
      }),
      event('wp', 'wp.post_meta.updated', 3_090, {
        requestId: 'yoast-1', objectType: 'post-meta', objectId: 301, metaId: 501,
        metaKey: '_yoast_wpseo_title', plugin: 'yoast-seo', namespace: 'yoast', metaFamily: 'seo',
        valueType: 'string', channel: 'rest', transport: 'http',
      }),
      event('wp', 'wp.post_meta.updated', 3_180, {
        requestId: 'yoast-1', objectType: 'post-meta', objectId: 301, metaId: 502,
        metaKey: '_yoast_wpseo_metadesc', plugin: 'yoast-seo', namespace: 'yoast', metaFamily: 'seo',
        valueType: 'string', channel: 'rest', transport: 'http',
      }),
    ],
  },

  connectorLifecycle: {
    id: 'wp-connector-lifecycle',
    target,
    description: 'REST and WP-CLI connectors retain independent transport and recovery phases',
    events: [
      event('wp', 'presence.open', 4_000, {
        connectionId: 'rest-lifecycle-1', channel: 'rest', transport: 'http', actor: 'qa-agent',
      }),
      event('wp', 'presence.ready', 4_020, {
        connectionId: 'rest-lifecycle-1', channel: 'rest', transport: 'http',
      }),
      event('wp', 'presence.heartbeat', 4_500, {
        connectionId: 'rest-lifecycle-1', channel: 'rest', transport: 'http',
      }),
      event('wp', 'presence.error', 4_760, {
        connectionId: 'rest-lifecycle-1', channel: 'rest', transport: 'http', error: 'connection reset',
      }),
      event('wp', 'presence.reconnect', 5_100, {
        connectionId: 'rest-lifecycle-1', channel: 'rest', transport: 'http',
      }),
      event('wp', 'presence.ready', 5_120, {
        connectionId: 'rest-lifecycle-1', channel: 'rest', transport: 'http',
      }),
      event('wp', 'presence.disconnect', 5_500, {
        connectionId: 'rest-lifecycle-1', channel: 'rest', transport: 'http',
      }),
      event('wp', 'presence.close', 5_540, {
        connectionId: 'rest-lifecycle-1', channel: 'rest', transport: 'http',
      }),
      event('wp', 'presence.open', 4_100, {
        connectionId: 'cli-lifecycle-1', channel: 'wp-cli', transport: 'ssh', actor: 'qa-agent',
      }),
      event('wp', 'presence.ready', 4_240, {
        connectionId: 'cli-lifecycle-1', channel: 'wp-cli', transport: 'ssh',
      }),
      event('wp', 'presence.close', 4_700, {
        connectionId: 'cli-lifecycle-1', channel: 'wp-cli', transport: 'ssh',
      }),
    ],
  },

  abilities: {
    id: 'wp-abilities-mcp',
    target,
    description: 'Generic WordPress Ability is declared by MCP and observed at execution hooks',
    events: [
      event('mcp', 'presence.ready', 6_000, {
        connectionId: 'mcp-ability-1', requestId: 'ability-1', channel: 'mcp', transport: 'stdio',
      }),
      event('mcp', 'mcp.ability.call', 6_010, {
        requestId: 'ability-1', ability: 'core/get-site-info', channel: 'mcp', transport: 'stdio',
        summary: 'Read WordPress site information',
      }),
      event('wp', 'wp.ability.invoked', 6_045, {
        requestId: 'ability-1', ability: 'core/get-site-info', channel: 'rest', transport: 'docker-network',
      }, 6_052),
      event('wp', 'wp.ability.executed', 6_080, {
        requestId: 'ability-1', ability: 'core/get-site-info', outcome: 'success',
        channel: 'rest', transport: 'docker-network',
      }, 6_088),
      event('mcp', 'presence.close', 6_120, {
        connectionId: 'mcp-ability-1', requestId: 'ability-1', channel: 'mcp', transport: 'stdio',
      }),
    ],
  },

  wpCliEdit: {
    id: 'wp-wpcli-edit',
    target,
    description: 'A real WP-CLI process is visible as process-over-Docker, not mislabeled as SSH',
    events: [
      event('cli', 'cli.command.declared', 7_000, {
        requestId: 'cli-edit-1', commandFamily: 'post update', objectType: 'post', objectId: 302,
        channel: 'wp-cli', transport: 'docker-exec', summary: 'Update the aphelion-test draft',
      }),
      event('cli', 'presence.open', 7_020, {
        connectionId: 'cli-edit-1', requestId: 'cli-edit-1', channel: 'wp-cli', transport: 'docker-exec',
      }),
      event('wp', 'wp.post.updated', 7_095, {
        requestId: 'cli-edit-1', objectType: 'post', objectId: 302, postType: 'post',
        title: 'aphelion-test-cli-post', status: 'draft', channel: 'wp-cli', transport: 'docker-exec',
        changedProperties: ['content', 'title'], blocks: ['core/paragraph'], blockCount: 1,
      }),
      event('cli', 'presence.close', 7_140, {
        connectionId: 'cli-edit-1', requestId: 'cli-edit-1', channel: 'wp-cli', transport: 'docker-exec',
      }),
    ],
  },
}

export function journeyEvents(...names) {
  const selected = names.length ? names : Object.keys(wordpressJourneys)
  return selected.flatMap(name => wordpressJourneys[name].events)
}

