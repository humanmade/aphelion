<?php
/**
 * Plugin Name: Aphelion Audit Observer
 * Description: Writes a local, redacted audit stream for Aphelion. No settings and no remote transport.
 * Version: 0.1.0
 * Requires PHP: 7.4
 * License: MIT
 */

defined( 'ABSPATH' ) || exit;

final class Aphelion_Audit_Observer {
	/** @var string */
	private $request_id;

	/** @var array<int, WP_Post> */
	private $before_posts = [];

	/** @var bool */
	private $presence_open = false;

	public function __construct() {
		$this->request_id = $this->request_id();
		add_action( 'init', [ $this, 'open_presence' ], 1 );
		add_action( 'shutdown', [ $this, 'close_presence' ], 9999 );
		add_action( 'pre_post_update', [ $this, 'post_before_update' ], 10, 2 );
		add_action( 'save_post', [ $this, 'post_saved' ], 10, 3 );
		add_action( 'trashed_post', [ $this, 'post_trashed' ], 10, 1 );
		add_action( 'untrashed_post', [ $this, 'post_untrashed' ], 10, 1 );
		add_action( 'deleted_post', [ $this, 'post_deleted' ], 10, 2 );
		add_action( 'updated_option', [ $this, 'option_updated' ], 10, 3 );
		add_action( 'added_option', [ $this, 'option_added' ], 10, 2 );
		add_action( 'deleted_option', [ $this, 'option_deleted' ], 10, 1 );
		add_action( 'added_post_meta', [ $this, 'post_meta_added' ], 10, 4 );
		add_action( 'updated_post_meta', [ $this, 'post_meta_updated' ], 10, 4 );
		add_action( 'deleted_post_meta', [ $this, 'post_meta_deleted' ], 10, 4 );
		add_action( 'created_term', [ $this, 'term_created' ], 10, 3 );
		add_action( 'edited_term', [ $this, 'term_updated' ], 10, 3 );
		add_action( 'delete_term', [ $this, 'term_deleted' ], 10, 5 );
		add_action( 'activated_plugin', [ $this, 'plugin_activated' ], 10, 2 );
		add_action( 'deactivated_plugin', [ $this, 'plugin_deactivated' ], 10, 2 );
		add_filter( 'rest_request_after_callbacks', [ $this, 'rest_completed' ], 10, 3 );
		add_action( 'wp_after_execute_ability', [ $this, 'ability_executed' ], 10, 3 );
		add_action( 'wp_ability_invoked', [ $this, 'ability_invoked' ], 10, 3 );
	}

	private function log_path() : string {
		return defined( 'APHELION_AUDIT_LOG' )
			? (string) APHELION_AUDIT_LOG
			: WP_CONTENT_DIR . '/aphelion/audit.jsonl';
	}

	private function request_id() : string {
		foreach ( [ 'HTTP_X_APHELION_CORRELATION', 'HTTP_X_REQUEST_ID', 'HTTP_X_CORRELATION_ID' ] as $header ) {
			if ( ! empty( $_SERVER[ $header ] ) ) {
				return substr( sanitize_key( wp_unslash( $_SERVER[ $header ] ) ), 0, 64 );
			}
		}
		return wp_generate_uuid4();
	}

	private function channel() : string {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			return 'wp-cli';
		}
		$hint = sanitize_key( $_SERVER['HTTP_X_APHELION_CHANNEL'] ?? '' );
		if ( in_array( $hint, [ 'mcp', 'rest', 'wp-admin', 'wp-cli' ], true ) ) {
			return $hint;
		}
		$request_uri = (string) ( $_SERVER['REQUEST_URI'] ?? '' );
		if ( ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || strpos( $request_uri, '/wp-json/' ) !== false || isset( $_GET['rest_route'] ) ) {
			return 'rest';
		}
		if ( defined( 'DOING_AJAX' ) && DOING_AJAX && ( $_REQUEST['action'] ?? '' ) === 'heartbeat' ) {
			return 'wp-admin-heartbeat';
		}
		if ( defined( 'DOING_CRON' ) && DOING_CRON ) {
			return 'cron';
		}
		if ( is_admin() ) {
			return 'wp-admin';
		}
		return 'wordpress';
	}

	private function actor() : array {
		$user = wp_get_current_user();
		return [
			'id'    => (int) $user->ID,
			'login' => $user->exists() ? sanitize_user( $user->user_login ) : null,
			'roles' => $user->exists() ? array_values( array_map( 'sanitize_key', (array) $user->roles ) ) : [],
		];
	}

	private function context() : array {
		$channel = $this->channel();
		return [
			'channel'      => $channel,
			'transport'    => $channel === 'wp-cli' ? 'process' : 'http',
			'channelSource' => $this->channel_source( $channel ),
			'requestId'    => $this->request_id,
			'actor'        => $this->actor(),
			'site'         => home_url( '/' ),
			'adminScreen'  => function_exists( 'get_current_screen' ) && get_current_screen() ? get_current_screen()->id : null,
		];
	}

	private function channel_source( string $channel ) : string {
		$hint = sanitize_key( $_SERVER['HTTP_X_APHELION_CHANNEL'] ?? '' );
		return $channel === $hint ? 'request-hint' : 'wordpress-context';
	}

	private function emit( string $kind, array $data = [] ) : void {
		if ( defined( 'APHELION_OBSERVER_PROBE' ) && APHELION_OBSERVER_PROBE ) {
			return;
		}
		$path = $this->log_path();
		if ( ! wp_mkdir_p( dirname( $path ) ) ) {
			return;
		}
		$record = [
			'v'    => 1,
			'ts'   => (int) round( microtime( true ) * 1000 ),
			'kind' => preg_replace( '/[^a-z0-9._-]/', '', strtolower( $kind ) ),
			'data' => array_merge( $this->context(), $data ),
		];
		file_put_contents( $path, wp_json_encode( $record, JSON_UNESCAPED_SLASHES ) . "\n", FILE_APPEND | LOCK_EX ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
	}

	private function is_observable_request() : bool {
		if ( defined( 'APHELION_OBSERVER_PROBE' ) && APHELION_OBSERVER_PROBE ) {
			return false;
		}
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			return true;
		}
		$request_uri = (string) ( $_SERVER['REQUEST_URI'] ?? '' );
		if ( ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || strpos( $request_uri, '/wp-json/' ) !== false || isset( $_GET['rest_route'] ) ) {
			return true;
		}
		if ( defined( 'DOING_AJAX' ) && DOING_AJAX && ( $_REQUEST['action'] ?? '' ) === 'heartbeat' ) {
			return true;
		}
		$method = strtoupper( sanitize_key( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) );
		return is_admin() && in_array( $method, [ 'POST', 'PUT', 'PATCH', 'DELETE' ], true );
	}

	public function open_presence() : void {
		if ( ! $this->is_observable_request() ) {
			return;
		}
		if ( $this->channel() === 'wp-admin-heartbeat' ) {
			$actor = $this->actor();
			$this->emit( 'presence.heartbeat', [ 'connectionId' => 'wp-admin-heartbeat:' . (int) $actor['id'] ] );
			return;
		}
		$this->presence_open = true;
		$this->emit( 'presence.open', [ 'connectionId' => $this->request_id ] );
	}

	public function close_presence() : void {
		if ( $this->presence_open ) {
			$this->emit( 'presence.close', [ 'connectionId' => $this->request_id ] );
		}
	}

	public function post_before_update( int $post_id, array $data ) : void {
		$post_before = get_post( $post_id );
		if ( $post_before instanceof WP_Post ) {
			$this->before_posts[ $post_id ] = $post_before;
		}
	}

	public function post_saved( int $post_id, WP_Post $post, bool $update ) : void {
		if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
			return;
		}
		$before = $this->before_posts[ $post_id ] ?? null;
		unset( $this->before_posts[ $post_id ] );
		$block_names = $this->block_names( parse_blocks( $post->post_content ) );
		$blocks = array_values( array_unique( $block_names ) );
		$block_changes = $this->block_changes(
			$before instanceof WP_Post ? parse_blocks( $before->post_content ) : [],
			parse_blocks( $post->post_content )
		);
		$this->emit( $update ? 'wp.post.updated' : 'wp.post.created', [
			'objectType' => 'post', 'objectId' => $post_id, 'postType' => $post->post_type,
			'title' => sanitize_text_field( get_the_title( $post ) ), 'status' => $post->post_status,
			'blocks' => $blocks, 'blockCount' => count( $block_names ), 'uniqueBlockCount' => count( $blocks ),
			'changedProperties' => $before instanceof WP_Post ? $this->post_changes( $before, $post ) : [ 'content' ],
			'blockChanges' => $block_changes,
		] );
	}

	private function block_names( array $blocks ) : array {
		$names = [];
		foreach ( $blocks as $block ) {
			if ( ! empty( $block['blockName'] ) ) { $names[] = sanitize_text_field( $block['blockName'] ); }
			if ( ! empty( $block['innerBlocks'] ) ) { $names = array_merge( $names, $this->block_names( $block['innerBlocks'] ) ); }
		}
		return $names;
	}

	private function block_snapshot( array $blocks, string $prefix = '' ) : array {
		$snapshot = [];
		foreach ( $blocks as $index => $block ) {
			$path = $prefix === '' ? (string) $index : $prefix . '.' . $index;
			$attributes = is_array( $block['attrs'] ?? null ) ? $block['attrs'] : [];
			$snapshot[ $path ] = [
				'name' => ! empty( $block['blockName'] ) ? sanitize_text_field( $block['blockName'] ) : 'core/freeform',
				'attributes' => $attributes,
			];
			if ( ! empty( $block['innerBlocks'] ) ) {
				$snapshot = array_merge( $snapshot, $this->block_snapshot( $block['innerBlocks'], $path ) );
			}
		}
		return $snapshot;
	}

	private function block_changes( array $before, array $after ) : array {
		$old = $this->block_snapshot( $before );
		$new = $this->block_snapshot( $after );
		$paths = array_unique( array_merge( array_keys( $old ), array_keys( $new ) ) );
		$changes = [];
		foreach ( $paths as $path ) {
			$previous = $old[ $path ] ?? null;
			$current = $new[ $path ] ?? null;
			if ( ! $previous && $current ) {
				$changes[] = [ 'path' => $path, 'name' => $current['name'], 'change' => 'added', 'properties' => array_keys( $current['attributes'] ) ];
				continue;
			}
			if ( $previous && ! $current ) {
				$changes[] = [ 'path' => $path, 'name' => $previous['name'], 'change' => 'removed', 'properties' => array_keys( $previous['attributes'] ) ];
				continue;
			}
			if ( $previous['name'] !== $current['name'] ) {
				$changes[] = [ 'path' => $path, 'name' => $current['name'], 'change' => 'replaced', 'properties' => array_values( array_unique( array_merge( array_keys( $previous['attributes'] ), array_keys( $current['attributes'] ) ) ) ) ];
				continue;
			}
			$property_names = array_unique( array_merge( array_keys( $previous['attributes'] ), array_keys( $current['attributes'] ) ) );
			$changed = [];
			foreach ( $property_names as $property ) {
				$old_value = $previous['attributes'][ $property ] ?? null;
				$new_value = $current['attributes'][ $property ] ?? null;
				if ( maybe_serialize( $old_value ) !== maybe_serialize( $new_value ) || array_key_exists( $property, $previous['attributes'] ) !== array_key_exists( $property, $current['attributes'] ) ) {
					$changed[] = sanitize_key( $property );
				}
			}
			if ( $changed ) {
				$changes[] = [ 'path' => $path, 'name' => $current['name'], 'change' => 'updated', 'properties' => array_values( array_unique( $changed ) ) ];
			}
		}
		return $changes;
	}

	private function post_changes( WP_Post $before, WP_Post $after ) : array {
		$fields = [
			'post_title'   => 'title',
			'post_name'    => 'slug',
			'post_status'  => 'status',
			'post_excerpt' => 'excerpt',
			'post_content' => 'content',
		];
		$changed = [];
		foreach ( $fields as $property => $label ) {
			if ( maybe_serialize( $before->{$property} ) !== maybe_serialize( $after->{$property} ) ) {
				$changed[] = $label;
			}
		}
		return $changed;
	}

	public function post_trashed( int $post_id ) : void {
		$this->emit( 'wp.post.trashed', [ 'objectType' => 'post', 'objectId' => $post_id, 'title' => sanitize_text_field( get_the_title( $post_id ) ) ] );
	}

	public function post_untrashed( int $post_id ) : void {
		$post = get_post( $post_id );
		$this->emit( 'wp.post.restored', [ 'objectType' => 'post', 'objectId' => $post_id, 'postType' => $post instanceof WP_Post ? $post->post_type : null, 'title' => sanitize_text_field( get_the_title( $post_id ) ) ] );
	}

	public function post_deleted( int $post_id, WP_Post $post ) : void {
		$this->emit( 'wp.post.deleted', [ 'objectType' => 'post', 'objectId' => $post_id, 'postType' => $post->post_type, 'title' => sanitize_text_field( $post->post_title ) ] );
	}

	public function option_updated( string $option, $old_value, $value ) : void {
		if ( $this->ignore_option( $option ) ) { return; }
		$this->emit( 'wp.option.updated', [
			'objectType' => 'option',
			'name' => sanitize_key( $option ),
			'changed' => maybe_serialize( $old_value ) !== maybe_serialize( $value ),
			'beforeType' => $this->value_type( $old_value ),
			'afterType' => $this->value_type( $value ),
		] );
	}

	public function option_added( string $option, $value ) : void {
		if ( $this->ignore_option( $option ) ) { return; }
		$this->emit( 'wp.option.created', [ 'objectType' => 'option', 'name' => sanitize_key( $option ), 'valueType' => $this->value_type( $value ) ] );
	}

	public function option_deleted( string $option ) : void {
		if ( $this->ignore_option( $option ) ) { return; }
		$this->emit( 'wp.option.deleted', [ 'objectType' => 'option', 'name' => sanitize_key( $option ) ] );
	}

	private function ignore_option( string $option ) : bool {
		return strpos( $option, '_transient_' ) === 0 || strpos( $option, '_site_transient_' ) === 0 || in_array( $option, [ 'cron', 'category_children', 'rewrite_rules', 'recently_edited' ], true );
	}

	private function value_type( $value ) : string {
		if ( null === $value ) { return 'null'; }
		if ( is_array( $value ) ) { return 'array'; }
		if ( is_object( $value ) ) { return 'object'; }
		if ( is_bool( $value ) ) { return 'boolean'; }
		if ( is_int( $value ) ) { return 'integer'; }
		if ( is_float( $value ) ) { return 'float'; }
		return 'string';
	}

	private function meta_context( string $meta_key ) : array {
		if ( strpos( $meta_key, '_yoast_wpseo_' ) === 0 ) {
			return [ 'plugin' => 'yoast-seo', 'namespace' => 'yoast', 'metaFamily' => 'seo' ];
		}
		if ( strpos( $meta_key, 'rank_math_' ) === 0 ) {
			return [ 'plugin' => 'rank-math', 'namespace' => 'rank-math', 'metaFamily' => 'seo' ];
		}
		if ( strpos( $meta_key, '_aioseo_' ) === 0 ) {
			return [ 'plugin' => 'all-in-one-seo', 'namespace' => 'aioseo', 'metaFamily' => 'seo' ];
		}
		if ( strpos( $meta_key, '_altis_ab_test_' ) === 0 ) {
			return [ 'plugin' => 'altis-accelerate', 'namespace' => 'accelerate', 'metaFamily' => 'experiment' ];
		}
		return [ 'plugin' => null, 'namespace' => null, 'metaFamily' => null ];
	}

	private function post_meta( string $kind, int $meta_id, int $post_id, string $meta_key, $value = null ) : void {
		if ( in_array( $meta_key, [ '_edit_lock', '_edit_last' ], true ) ) { return; }
		$this->emit( $kind, array_merge(
			[ 'objectType' => 'post-meta', 'objectId' => $post_id, 'metaId' => $meta_id, 'metaKey' => sanitize_key( $meta_key ), 'valueType' => $this->value_type( $value ) ],
			$this->meta_context( $meta_key )
		) );
	}

	public function post_meta_added( int $meta_id, int $post_id, string $meta_key, $value ) : void { $this->post_meta( 'wp.post_meta.created', $meta_id, $post_id, $meta_key, $value ); }
	public function post_meta_updated( int $meta_id, int $post_id, string $meta_key, $value ) : void { $this->post_meta( 'wp.post_meta.updated', $meta_id, $post_id, $meta_key, $value ); }
	public function post_meta_deleted( array $meta_ids, int $post_id, string $meta_key, $value ) : void { $this->post_meta( 'wp.post_meta.deleted', (int) reset( $meta_ids ), $post_id, $meta_key, $value ); }

	private function term( string $kind, int $term_id, int $term_taxonomy_id, string $taxonomy ) : void {
		$term = get_term( $term_id, $taxonomy );
		$this->emit( $kind, [ 'objectType' => 'term', 'objectId' => $term_id, 'termTaxonomyId' => $term_taxonomy_id, 'taxonomy' => sanitize_key( $taxonomy ), 'title' => $term instanceof WP_Term ? sanitize_text_field( $term->name ) : null ] );
	}

	public function term_created( int $term_id, int $term_taxonomy_id, string $taxonomy ) : void { $this->term( 'wp.term.created', $term_id, $term_taxonomy_id, $taxonomy ); }
	public function term_updated( int $term_id, int $term_taxonomy_id, string $taxonomy ) : void { $this->term( 'wp.term.updated', $term_id, $term_taxonomy_id, $taxonomy ); }
	public function term_deleted( int $term_id, int $term_taxonomy_id, string $taxonomy, $deleted_term, array $object_ids ) : void { $this->term( 'wp.term.deleted', $term_id, $term_taxonomy_id, $taxonomy ); }

	public function plugin_activated( string $plugin, bool $network_wide ) : void { $this->emit( 'wp.plugin.activated', [ 'objectType' => 'plugin', 'name' => sanitize_text_field( $plugin ), 'networkWide' => $network_wide ] ); }
	public function plugin_deactivated( string $plugin, bool $network_wide ) : void { $this->emit( 'wp.plugin.deactivated', [ 'objectType' => 'plugin', 'name' => sanitize_text_field( $plugin ), 'networkWide' => $network_wide ] ); }

	public function rest_completed( $response, array $handler, WP_REST_Request $request ) {
		if ( in_array( $request->get_method(), [ 'POST', 'PUT', 'PATCH', 'DELETE' ], true ) ) {
			if ( is_wp_error( $response ) ) {
				$error_data = $response->get_error_data();
				$status = is_array( $error_data ) && isset( $error_data['status'] ) ? (int) $error_data['status'] : 500;
			} else {
				$status = $response instanceof WP_REST_Response ? $response->get_status() : 200;
			}
			$this->emit( 'wp.rest.write', [ 'route' => sanitize_text_field( $request->get_route() ), 'method' => $request->get_method(), 'status' => (int) $status ] );
		}
		return $response;
	}

	public function ability_invoked( ...$args ) : void {
		$ability = $args[0] ?? null;
		$name = is_object( $ability ) && method_exists( $ability, 'get_name' ) ? $ability->get_name() : ( is_string( $ability ) ? $ability : 'unknown' );
		$this->emit( 'wp.ability.invoked', [ 'ability' => sanitize_text_field( $name ) ] );
	}

	public function ability_executed( $ability_name, $input = null, $result = null ) : void {
		$name = is_object( $ability_name ) && method_exists( $ability_name, 'get_name' ) ? $ability_name->get_name() : (string) $ability_name;
		$this->emit( 'wp.ability.executed', [ 'ability' => sanitize_text_field( $name ), 'outcome' => is_wp_error( $result ) ? 'error' : 'success' ] );
	}
}

new Aphelion_Audit_Observer();
