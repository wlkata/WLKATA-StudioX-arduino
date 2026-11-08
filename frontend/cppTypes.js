/* C++ declarations are authoritative; kinds are derived Blockly categories. */
(function (root) {
  function category(cppType, legacyKind = 'cpp') {
    if (typeof cppType !== 'string' || !cppType.trim()) return legacyKind || 'cpp';
    const type = cppType.replace(/\b(const|volatile|constexpr)\b/g, '').replace(/\s+/g, ' ').trim();
    if (type === 'void') return 'void';
    if (type === 'bool' || type === 'boolean') return 'boolean';
    if (['String', 'std::string'].includes(type) || /^char\s*\*$/.test(type) && /\bconst\b/.test(cppType)) return 'text';
    if (/^(?:(?:unsigned|signed|long|short)\s+)*(?:int|char|double|float|long|short)$/.test(type) ||
        /^(?:std::)?(?:u?int\d+_t|size_t|ssize_t|ptrdiff_t|intptr_t|uintptr_t)$/.test(type) ||
        ['unsigned', 'signed', 'byte', 'word'].includes(type)) return 'number';
    return 'cpp';
  }

  function signature(spec) {
    if (!spec) return spec;
    const normalized = {...spec};
    if (spec.constructor || spec.returnType !== undefined || spec.returnKind !== undefined) {
      normalized.returnKind = spec.constructor ? 'void' : category(spec.returnType, spec.returnKind);
    }
    if (Array.isArray(spec.parameters)) {
      normalized.parameters = spec.parameters.map(parameter => ({
        ...parameter, kind: category(parameter.type, parameter.kind)
      }));
    }
    return normalized;
  }

  const scalar = type => type === 'number' || type === 'boolean';
  const comparable = (left, right) => left === right && left !== 'void' || scalar(left) && scalar(right);

  function functionKey(spec) {
    // A return type cannot distinguish C++ overloads. Let a refreshed header
    // replace a saved signature without switching libraries or overloads.
    return JSON.stringify([spec.library || '', spec.header || '', spec.qualifiedName,
      !!spec.constructor, !!spec.static, (spec.parameters || []).map(parameter => parameter.type), spec.conditions || []]);
  }

  function configureWorkspace(workspace) {
    const checker = workspace.connectionChecker;
    if (checker.studioxCppComparisons_) return;
    const original = checker.doTypeChecks;
    checker.doTypeChecks = function (left, right) {
      const a = left.getSourceBlock(), b = right.getSourceBlock();
      const parent = a.getParent();
      // Blockly compares the two output connections here. Actual input/socket
      // checks stay strict, and other workspaces keep their original checker.
      if (a.outputConnection === left && b.outputConnection === right &&
          parent?.type === 'logic_compare' && b.getParent() === parent &&
          left.getCheck()?.some(type => ['Number', 'Boolean'].includes(type)) &&
          right.getCheck()?.some(type => ['Number', 'Boolean'].includes(type))) return true;
      return original.call(this, left, right);
    };
    checker.studioxCppComparisons_ = true;
  }

  const api = {category, signature, comparable, functionKey, configureWorkspace};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.StudioXArduinoCppTypes = api;
})(typeof window !== 'undefined' ? window : globalThis);
