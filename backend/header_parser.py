"""Read public C++ declarations using syntax trees; never import library code."""
import hashlib
import re


def _parser():
    try:
        from tree_sitter import Language, Parser
        import tree_sitter_cpp
    except ImportError as error:
        raise RuntimeError('Run Arduino Re-setup in Settings → Extensions to install the C++ header parser.') from error
    return Parser(Language(tree_sitter_cpp.language()))


def value_kind(cpp_type):
    text = re.sub(r'\b(const|volatile|constexpr)\b', '', cpp_type)
    text = re.sub(r'\s+', ' ', text).strip()
    if text == 'void':
        return 'void'
    if text == 'bool':
        return 'boolean'
    if text in ('String', 'std::string') or re.fullmatch(r'char\s*\*', text) and 'const' in cpp_type:
        return 'text'
    if re.fullmatch(r'(?:(?:unsigned|signed|long|short)\s+)*(?:int|char|double|float|long|short)|u?int\d+_t|size_t|ssize_t|byte|word', text):
        return 'number'
    return 'cpp'


def parse_header(content, header, library):
    parser = _parser()
    source = content if isinstance(content, bytes) else content.encode('utf-8')
    tree = parser.parse(source)
    functions, constants, instances = [], [], []
    classes, seen = {}, set()

    def text(node):
        return source[node.start_byte:node.end_byte].decode('utf-8', errors='replace') if node else ''

    def child(node, name):
        return node.child_by_field_name(name)

    def qualify(parts):
        return '::'.join(part for part in parts if part)

    def identifier(node):
        if node is None:
            return None
        if node.type in ('identifier', 'field_identifier', 'type_identifier', 'qualified_identifier', 'destructor_name', 'operator_name'):
            return node
        declarator = child(node, 'declarator')
        if declarator:
            return identifier(declarator)
        return next((found for item in node.named_children if (found := identifier(item)) is not None), None)

    def find_function(node):
        if node is None:
            return None
        if node.type == 'function_declarator':
            return node
        # Avoid treating a function pointer variable as a callable declaration.
        if node.type in ('parameter_list', 'parenthesized_declarator'):
            return None
        for item in node.named_children:
            found = find_function(item)
            if found:
                return found
        return None

    def parameter(node, index):
        name_node = identifier(child(node, 'declarator'))
        default = child(node, 'default_value')
        end = default.start_byte if default else node.end_byte
        raw = source[node.start_byte:end].decode('utf-8', errors='replace').rstrip(' =')
        if name_node:
            offset = name_node.start_byte - node.start_byte
            raw_bytes = source[node.start_byte:end]
            raw = (raw_bytes[:offset] + raw_bytes[offset + name_node.end_byte - name_node.start_byte:]).decode('utf-8', errors='replace').rstrip(' =')
        cpp_type = re.sub(r'\s+', ' ', raw).strip()
        kind = value_kind(cpp_type)
        # References and mutable pointers require an actual C++ lvalue/pointer.
        if '&' in cpp_type or '*' in cpp_type and kind != 'text':
            kind = 'cpp'
        return {'name': text(name_node) or 'arg' + str(index + 1), 'type': cpp_type,
                'kind': kind, 'optional': default is not None, 'default': text(default)}

    def add_function(node, namespace, owner, public, conditions, templated):
        fn = find_function(child(node, 'declarator'))
        if not fn:
            return False
        name_node = child(fn, 'declarator')
        name = text(name_node)
        if not public or name.startswith('~'):
            return True
        constructor = bool(owner and name == owner.split('::')[-1])
        if constructor:
            classes[owner]['declaredConstructor'] = True
        prefix = source[node.start_byte:fn.start_byte].decode('utf-8', errors='replace')
        cpp_type = re.sub(r'\b(?:static|inline|virtual|constexpr|explicit|extern|friend)\b', '', prefix).strip()
        static = bool(re.search(r'\bstatic\b', prefix))
        params_node = child(fn, 'parameters')
        params = [parameter(item, index) for index, item in enumerate(params_node.named_children)
                  if item.type in ('parameter_declaration', 'optional_parameter_declaration')]
        if len(params) == 1 and params[0]['type'] == 'void':
            params = []
        unsupported = ''
        if templated:
            unsupported = 'Function templates require Advanced C++.'
        elif not re.fullmatch(r'[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*', name):
            unsupported = 'Operators and complex declarators require Advanced C++.'
        elif any(item.type == 'variadic_parameter' for item in params_node.named_children) or '...' in text(params_node):
            unsupported = 'Variadic functions require Advanced C++.'
        elif len(params) > 16:
            unsupported = 'Functions with more than 16 parameters require Advanced C++.'
        elif '= delete' in text(node) or '=delete' in text(node):
            unsupported = 'This function is deleted.'
        elif constructor and classes[owner].get('abstract'):
            unsupported = 'Abstract classes cannot be constructed.'
        qualified = owner if constructor else qualify([owner or qualify(namespace), name])
        label = qualified + '(' + ', '.join(item['type'] + ' ' + item['name'] + (' = ' + item['default'] if item['optional'] else '') for item in params) + ')'
        identity = label + '|' + cpp_type + '|' + '|'.join(conditions)
        if identity in seen:
            return True
        seen.add(identity)
        functions.append({'id': hashlib.sha256(identity.encode()).hexdigest()[:20], 'library': library,
                          'header': header, 'name': name, 'qualifiedName': qualified,
                          'owner': owner or '', 'constructor': constructor, 'static': static,
                          'parameters': params, 'returnType': cpp_type or 'void',
                          'returnKind': 'void' if constructor else value_kind(cpp_type),
                          'label': label, 'supported': not unsupported, 'reason': unsupported,
                          'conditions': conditions})
        return True

    def visit(node, namespace=(), owner=None, public=True, conditions=(), templated=False):
        kind = node.type
        if kind == 'namespace_definition':
            name = text(child(node, 'name'))
            if not name:
                return
            body = child(node, 'body')
            if body:
                for item in body.named_children:
                    visit(item, (*namespace, name), owner, public, conditions, templated)
            return
        if kind in ('class_specifier', 'struct_specifier'):
            if owner and not public:
                return
            name = text(child(node, 'name'))
            if not name:
                return
            qualified = qualify([owner or qualify(namespace), name])
            body = child(node, 'body')
            if not body:
                return
            abstract = bool(re.search(r'\)\s*(?:const\s*)?=\s*0\s*;', text(body)))
            classes[qualified] = {'declaredConstructor': False, 'abstract': abstract,
                                  'namespace': namespace, 'name': name, 'conditions': conditions, 'template': templated}
            access = kind == 'struct_specifier'
            for item in body.named_children:
                if item.type == 'access_specifier':
                    access = text(item) == 'public'
                else:
                    # Private constructors suppress an implicit default constructor.
                    if find_function(child(item, 'declarator')) and text(child(find_function(child(item, 'declarator')), 'declarator')) == name:
                        classes[qualified]['declaredConstructor'] = True
                    visit(item, namespace, qualified, access, conditions, templated)
            return
        if kind == 'template_declaration':
            for item in node.named_children:
                if item.type != 'template_parameter_list':
                    visit(item, namespace, owner, public, conditions, True)
            return
        if kind.startswith('preproc_if') or kind in ('preproc_else', 'preproc_elif'):
            line = text(node).splitlines()[0][:200]
            for item in node.named_children:
                if item != child(node, 'condition'):
                    visit(item, namespace, owner, public, (*conditions, line), templated)
            return
        if kind in ('declaration', 'field_declaration', 'function_definition'):
            if add_function(node, namespace, owner, public, list(conditions), templated):
                return
            if not owner:
                name_node = identifier(child(node, 'declarator'))
                name = text(name_node)
                cpp_type = text(child(node, 'type'))
                if re.fullmatch(r'[A-Za-z_]\w*', name):
                    instances.append({'name': name, 'qualifiedName': qualify([qualify(namespace), name]),
                                      'type': cpp_type, 'namespace': qualify(namespace)})
            # A declaration can wrap a struct/class definition.
            for item in node.named_children:
                if item.type in ('class_specifier', 'struct_specifier', 'enum_specifier'):
                    visit(item, namespace, owner, public, conditions, templated)
            return
        if kind == 'preproc_def' and not owner:
            name, value = text(child(node, 'name')), text(child(node, 'value')).strip()
            if value and re.fullmatch(r'[A-Za-z_]\w*', name) and not any(part in value for part in ('{', '#', '\n', '\\')):
                result_kind = 'boolean' if value in ('true', 'false') else 'text' if value.startswith('"') else 'number'
                constants.append({'header': header, 'library': library, 'name': name, 'qualifiedName': name, 'kind': result_kind})
            return
        if kind == 'enum_specifier' and public:
            enum_name = text(child(node, 'name'))
            scoped = any(item.type in ('class', 'struct') for item in node.children)
            body = child(node, 'body')
            if body:
                for item in body.named_children:
                    if item.type == 'enumerator':
                        name = text(child(item, 'name'))
                        qualified = qualify([owner or qualify(namespace), enum_name if scoped else '', name])
                        constants.append({'header': header, 'library': library, 'name': name, 'qualifiedName': qualified, 'kind': 'number'})
            return
        if kind in ('translation_unit', 'declaration_list', 'linkage_specification'):
            for item in node.named_children:
                visit(item, namespace, owner, public, conditions, templated)

    visit(tree.root_node)
    for owner, info in classes.items():
        if not info['declaredConstructor'] and not info['abstract']:
            identity = owner + '()'
            functions.insert(0, {'id': hashlib.sha256(identity.encode()).hexdigest()[:20], 'library': library,
                                'header': header, 'name': info['name'], 'qualifiedName': owner, 'owner': owner,
                                'constructor': True, 'static': False, 'parameters': [], 'returnType': 'void',
                                'returnKind': 'void', 'label': identity, 'supported': not info['template'],
                                'reason': 'Class templates require Advanced C++.' if info['template'] else '',
                                'conditions': list(info['conditions'])})
    for function in functions:
        owner = function['owner']
        function['instances'] = [item for item in instances if item['type'] == owner or
                                 qualify([item['namespace'], item['type']]) == owner]
    return {'functions': functions, 'constants': list({item['qualifiedName']: item for item in constants}.values()),
            'parseErrors': tree.root_node.has_error}
