/** Contenido inicial de .php-cs-fixer.php creado desde la vista de GVHidra. */
export const PHP_CS_FIXER_CONFIGURATION = String.raw`<?php

declare(strict_types=1);

$finder = PhpCsFixer\Finder::create()
    ->in([
        __DIR__,
    ])
    ->exclude([
        'igep',
        'templates_c',
        'wscomun',
        'jasper',
        'custom',
        'vendor',
        'node_modules',
        '.git',
    ])
    ->name('*.php')
    ->ignoreDotFiles(true)
    ->ignoreVCS(true);

return (new PhpCsFixer\Config())
    // Hasta 15 minutos por lote, con detección automática del número de procesos.
    ->setParallelConfig(PhpCsFixer\Runner\Parallel\ParallelConfigFactory::detect(null, 900))
    ->setRiskyAllowed(false)
    ->setUsingCache(true)
    ->setRules([
        '@PSR12' => true,

        // Espaciado y saltos de línea
        'array_indentation' => true,
        'binary_operator_spaces' => [
            'default' => 'single_space',
        ],
        'blank_line_after_namespace' => true,
        'blank_line_after_opening_tag' => true,
        'blank_line_before_statement' => [
            'statements' => [
                'break',
                'continue',
                'declare',
                'return',
                'throw',
                'try',
            ],
        ],
        'braces_position' => [
            'allow_single_line_empty_anonymous_classes' => true,
            'allow_single_line_anonymous_functions' => false,
            'anonymous_classes_opening_brace' => 'same_line',
            'anonymous_functions_opening_brace' => 'same_line',
            'classes_opening_brace' => 'next_line_unless_newline_at_signature_end',
            'control_structures_opening_brace' => 'same_line',
            'functions_opening_brace' => 'next_line_unless_newline_at_signature_end',
        ],
        'class_attributes_separation' => [
            'elements' => [
                'const' => 'one',
                'method' => 'one',
                'property' => 'one',
                'trait_import' => 'none',
                'case' => 'none',
            ],
        ],
        'concat_space' => [
            'spacing' => 'one',
        ],
        'control_structure_braces' => true,
        'control_structure_continuation_position' => true,
        'declare_parentheses' => true,
        'elseif' => true,
        'encoding' => true,
        'function_declaration' => [
            'closure_fn_spacing' => 'one',
            'closure_function_spacing' => 'one',
        ],
        'indentation_type' => true,
        'line_ending' => true,
        'method_argument_space' => [
            'attribute_placement' => 'ignore',
            'keep_multiple_spaces_after_comma' => false,
            'on_multiline' => 'ensure_fully_multiline',
        ],
        'multiline_whitespace_before_semicolons' => [
            'strategy' => 'no_multi_line',
        ],
        'new_with_parentheses' => [
            'anonymous_class' => true,
            'named_class' => true,
        ],
        'no_blank_lines_after_class_opening' => true,
        'no_blank_lines_after_phpdoc' => true,
        'no_empty_statement' => true,
        'no_extra_blank_lines' => [
            'tokens' => [
                'attribute',
                'break',
                'case',
                'continue',
                'curly_brace_block',
                'default',
                'extra',
                'parenthesis_brace_block',
                'return',
                'square_brace_block',
                'switch',
                'throw',
                'use',
                'use_trait',
            ],
        ],
        'no_leading_import_slash' => true,
        'no_leading_namespace_whitespace' => true,
        'no_multiline_whitespace_around_double_arrow' => true,
        'no_singleline_whitespace_before_semicolons' => true,
        'no_spaces_around_offset' => true,
        'no_trailing_comma_in_singleline' => true,
        'no_trailing_whitespace' => true,
        'no_trailing_whitespace_in_comment' => true,
        'no_unneeded_control_parentheses' => true,
        'no_unused_imports' => true,
        'no_whitespace_before_comma_in_array' => true,
        'no_whitespace_in_blank_line' => true,
        'ordered_imports' => [
            'sort_algorithm' => 'alpha',
        ],
        'phpdoc_trim' => true,
        'phpdoc_trim_consecutive_blank_line_separation' => true,
        'single_blank_line_at_eof' => true,
        'single_import_per_statement' => true,
        'single_line_after_imports' => true,
        'single_quote' => false,
        'single_space_around_construct' => [
            'constructs_contain_a_single_space' => [
                'yield_from',
            ],
            'constructs_followed_by_a_single_space' => [
                'abstract',
                'as',
                'attribute',
                'break',
                'case',
                'catch',
                'class',
                'clone',
                'comment',
                'const',
                'const_import',
                'continue',
                'do',
                'echo',
                'else',
                'elseif',
                'enum',
                'extends',
                'final',
                'finally',
                'for',
                'foreach',
                'function',
                'function_import',
                'global',
                'goto',
                'if',
                'implements',
                'include',
                'include_once',
                'instanceof',
                'insteadof',
                'interface',
                'match',
                'named_argument',
                'namespace',
                'new',
                'open_tag_with_echo',
                'php_doc',
                'private',
                'protected',
                'public',
                'readonly',
                'require',
                'require_once',
                'return',
                'static',
                'switch',
                'throw',
                'trait',
                'try',
                'type_colon',
                'use',
                'use_lambda',
                'while',
                'yield',
                'yield_from',
            ],
            'constructs_preceded_by_a_single_space' => [
                'as',
                'else',
                'elseif',
                'use_lambda',
            ],
        ],
        'space_after_semicolon' => [
            'remove_in_empty_for_expressions' => true,
        ],
        'spaces_inside_parentheses' => [
            'space' => 'none',
        ],
        'statement_indentation' => true,
        'switch_case_semicolon_to_colon' => true,
        'switch_case_space' => true,
        'trim_array_spaces' => true,
        'types_spaces' => true,
        'unary_operator_spaces' => true,
        'whitespace_after_comma_in_array' => true,
    ])
    ->setFinder($finder);
`;
