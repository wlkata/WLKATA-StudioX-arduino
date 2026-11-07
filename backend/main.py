"""HTTP API for Arduino tooling. No physical device is opened at startup."""
from flask import Blueprint, jsonify, request
from arduino_manager import ArduinoManager

blueprint = Blueprint('arduino', __name__)
_manager = ArduinoManager()


def result(call):
    try:
        return jsonify(call())
    except (ValueError, RuntimeError, OSError) as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500


@blueprint.get('/status')
def status():
    return result(_manager.status)


@blueprint.post('/settings')
def settings():
    data = request.get_json(silent=True) or {}
    return result(lambda: _manager.configure(data.get('cliPath', '')))


@blueprint.get('/boards')
def boards():
    return result(_manager.boards)


@blueprint.get('/ports')
def ports():
    return result(_manager.ports)


@blueprint.post('/compile')
def compile_sketch():
    data = request.get_json(silent=True) or {}
    return result(lambda: _manager.compile(data.get('code'), data.get('board')))


@blueprint.post('/upload')
def upload():
    data = request.get_json(silent=True) or {}
    return result(lambda: _manager.upload(data.get('compileId'), data.get('port')))


@blueprint.post('/core/install')
def core():
    data = request.get_json(silent=True) or {}
    return result(lambda: _manager.install_core(data.get('board')))


@blueprint.get('/jobs/<identifier>')
def job(identifier):
    return result(lambda: _manager.job(identifier))


@blueprint.post('/jobs/<identifier>/cancel')
def cancel(identifier):
    return result(lambda: _manager.cancel(identifier))


@blueprint.post('/boards/search')
def search_boards():
    data = request.get_json(silent=True) or {}
    return result(lambda: _manager.search_boards(data.get('query', '')))


@blueprint.route('/boards/sources', methods=['GET', 'POST'])
def board_sources():
    if request.method == 'GET':
        return result(_manager.board_sources)
    data = request.get_json(silent=True) or {}
    if not isinstance(data.get('urls'), list):
        return jsonify({'success': False, 'error': 'Provide a list of board source URLs.'}), 400
    return result(lambda: _manager.board_sources(data['urls']))


@blueprint.post('/boards/refresh')
def refresh_boards():
    return result(_manager.refresh_board_index)


@blueprint.post('/boards/install')
def install_board_package():
    data = request.get_json(silent=True) or {}
    return result(lambda: _manager.install_platform(data.get('platform'), data.get('version', '')))


@blueprint.get('/libraries')
def libraries():
    return result(_manager.libraries)


@blueprint.post('/libraries/search')
def search_libraries():
    data = request.get_json(silent=True) or {}
    return result(lambda: _manager.search_libraries(data.get('query', '')))


@blueprint.post('/libraries/install')
def install_library():
    data = request.get_json(silent=True) or {}
    return result(lambda: _manager.install_library(data.get('name'), data.get('version', '')))


@blueprint.post('/libraries/refresh')
def refresh_library_index():
    return result(_manager.refresh_library_index)


@blueprint.post('/libraries/install-local')
def install_local_library():
    data = request.get_json(silent=True) or {}
    return result(lambda: _manager.install_local_library(data.get('path'), data.get('kind')))


@blueprint.post('/libraries/catalog')
def library_catalog():
    data = request.get_json(silent=True) or {}
    return result(lambda: _manager.library_catalog(data.get('board', '')))
