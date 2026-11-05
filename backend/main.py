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
