/*
Набор методов, расширяющих библиотеку XRegExp  
*/

'use strict';

const XRegExp = require('xregexp');

/**
 * Подставляет в регулярном выражении вместо тегов типа <tag> регулярные выражения из словаря
 * см. http://blog.stevenlevithan.com/archives/grammatical-patterns-xregexp-build
 *
 * TODO https://learn.javascript.ru/decorators#декоратор-для-проверки-типа
 *
 * @param   {RegExp|String} pattern
 * @param   {Object}        subs
 * @param   {String}        flags   Если передан флаг 'o', то рег. выражение на выходе будет обработано методом XRegExp.optimize()
 * @returns {RegExp}
 */
XRegExp.make = function(pattern, subs, flags = '') {
    let isOptimize          = flags.indexOf('o') > -1,
        patternTypeExpected = ['RegExp', 'String'],
        patternTypeGiven    = Object.prototype.toString.call(pattern).slice(8, -1);
    if (isOptimize) flags = flags.replace('o', '');
    if (patternTypeExpected.indexOf(patternTypeGiven) < 0)
        throw TypeError(`${patternTypeExpected.join(' or ')} types expected in 1st param, but ${patternTypeGiven} type given, value: ${pattern}`);
    if (patternTypeGiven === 'RegExp') pattern = pattern.source;
    let re = XRegExp.build(pattern.replace(/<([a-zA-Z\d]+)>/g, '{{$1}}'), subs, flags);
    if (isOptimize) re = XRegExp.optimize(re);
    return re;
};

/**
 * Комбинация методов RegExp.union() и RegExp.build() в одном методе
 *
 * @param   {Array}  keys
 * @param   {Object} subs
 * @param   {String} flags
 * @returns {RegExp}
 */
XRegExp.unionBuild = function(keys, subs, flags) {
    let patterns = [];
    for (let key of keys) {
        if (typeof key !== 'string') throw TypeError();
        patterns.push(XRegExp.build(`(?<${key}>{{${key}}})`, subs));
    }
    return XRegExp.union(patterns, flags);
};

/**
 * Исключение лишних скобок из из регулярных выражений.
 * Удаляет '(?:)' и лишнее оборачивание в '(?:' и ')'
 * Этот мусор вставляют некоторые методы XRegExp :(
 *
 * TODO: оптимизировать выражения типа:
 *      "(?:xx|(?:yy|zz))" => "(?:xx|yy|zz)"
 *      "(?!aa)(?!bb)"     => "(?!aa|bb)"
 *      "(?=[^a-z])"       => "(?![a-z])"
 *      "(?=[abc])[\s\S]"  => "[abc]"
 *
 * @param   {RegExp} pattern
 * @returns {RegExp}
 */
XRegExp.optimize = function callee(pattern) {

    const r = String.raw;

    let re, ret, s, ss;

    //кеширование
    if (callee.re) re = callee.re;
    else {
        re = {

            positionBegin : /\^/,
            positionEnd   : /\$/,

            groupBeginLookAheadNegative : /\(\?!/,
            groupBeginNonCapture : /\(\?:/,
            groupBeginAny : XRegExp(r`
                    \( (?!\?)   #capture
                |   \(\?:       #non capture
                |   \(\?[=!]    #look-ahead  positive/negative    
                |   \(\?<[=!]   #look-behind positive/negative
                |   \(\?<[a-zA-Z_][a-zA-Z\d_]*>  #capture with name
            `, 'x'),
            groupDelimiter : /\|/,
            groupEnd       : /\)/,

            classBegin    : /\[/,
            classNegative : /\^/,
            classRange    : /\-/,
            classEnd      : /\]/,

            charInGroup : /[^(|)[\\]/,
            charInClass : /[^\]\\]/,
            charDot     : /\./,
            charDigit   : /\d/,
            charEscaped : /\\[^ux] | \\x[\dA-Fa-f]{2} | \\u[\dA-Fa-f]{4} | \\u{[\dA-Fa-f]{1,6}}/,

            backRefer : /\\\d+|\\k<[a-zA-Z_][a-zA-Z\d_]*>/,

            quantifier : XRegExp(r`
                (?:
                     [?*+]
                  |  \{ 
                        (?:  \d+ (?:,\d*)? 
                          | ,\d+ 
                        )
                     \}
                )
                [+?]?   #atomic and ungreedy flag
            `, 'x'),
        };
        //console.log(re.groupBeginAny);

        //"(?:[abc])*"  => "[abc]*"
        //"(?:[^abc])*" => "[^abc]*"
        //"(?:y)+"      => "y+"
        //save backref in regexp like /\d\d([-.])\d\d(?:\1)20\d\d/
        re.all1 = XRegExp.make(r`
            <groupBeginNonCapture>
            (     <classBegin>
                      (?:  <charInClass>
                        |  <charEscaped>
                      )+
                  <classEnd>
                | <charInGroup>
                | (?! <backRefer> <groupEnd> <charDigit> )
                  <charEscaped>
            )  # $1
            <groupEnd>
        `, re, 'sxg');

        //"(?:[abc]*y+)"  => "[abc]*y+"
        //"(?:[^abc]*y+)" => "[^abc]*y+"
        //save backref in regexp like /\d\d([-.])\d\d(?:\1)20\d\d/
        re.all2 = XRegExp.make(r`
            <groupBeginNonCapture>
            ((?:  <classBegin>
                      (?:  <charInClass>
                        |  <charEscaped>
                      )+
                  <classEnd>     <quantifier>?
                | <charInGroup>  <quantifier>?
                | (?! <backRefer> <groupEnd> <charDigit> )
                  <charEscaped>  <quantifier>?
            )+)  # $1
            <groupEnd>
            (?! <quantifier> )
        `, re, 'sxg');

        //"[abc]|[def]" => "[abcdef]"
        re.all3 = XRegExp.make(r`
            (?<= <groupDelimiter> | <groupBeginAny> | ^)
            <classBegin>
            (
                (?! <classNegative>)
                (?:  <charInClass>
                  |  <charEscaped>
                )+
            ) # $1
            <classEnd>
            <groupDelimiter>
            <classBegin>
            (
                (?! <classNegative> | <classRange>)
                (?:  <charInClass>
                  |  <charEscaped>
                )+
            ) # $2
            <classEnd>
            (?= <groupDelimiter> | <groupEnd> | $)
        `, re, 'sxg');

        //"[abc]|x" => "[abcx]"
        re.all4 = XRegExp.make(r`
            (?<= <groupDelimiter> | <groupBeginAny> | ^)
            <classBegin>
            (
                (?! <classNegative>)
                (?:  <charInClass>
                  |  <charEscaped>
                )+
            ) # $1
            <classEnd>
            <groupDelimiter>
            (
                  (?! <positionBegin> | <positionEnd> | <classRange> | <classEnd> | <charDot>)
                  <charInGroup>
                | (?! <backRefer> )
                  <charEscaped>
            ) # $2
            (?= <groupDelimiter> | <groupEnd> | $)
        `, re, 'sxg');

        //"x|[abc]" => "[abcx]"
        re.all5 = XRegExp.make(r`
            (?<= <groupDelimiter> | <groupBeginAny> | ^)
            (
                  (?! <positionBegin> | <positionEnd> | <classRange> | <classEnd> | <charDot>)
                  <charInGroup>
                | (?! <backRefer> )
                  <charEscaped>
            ) # $1
            <groupDelimiter>
            <classBegin>
            (
                (?! <classNegative>)
                (?:  <charInClass>
                  |  <charEscaped>
                )+
            ) # $2
            <classEnd>
            (?= <groupDelimiter> | <groupEnd> | $)
        `, re, 'sxg');

        //"x|y" => "[xy]"
        re.all6 = XRegExp.make(r`
            (?<= <groupDelimiter> | <groupBeginAny> | ^)
            (
                  (?! <positionBegin> | <positionEnd> )
                  <charInGroup>
                | (?! <backRefer> )
                  <charEscaped>
            ) # $1
            <groupDelimiter>
            (
                  (?! <positionBegin> | <positionEnd> | <classRange> | <classEnd> | <charDot>)
                  <charInGroup>
                | (?! <backRefer> )
                  <charEscaped>
            ) # $2
            (?= <groupDelimiter> | <groupEnd> | $)
        `, re, 'sxg');

        //"(?![abc])[\s\S]" => "[^abc]"
        //"(?!x)[\d\D]"     => "[^x]"
        //save backref in regexp like /\d\d([-.])\d\d(?:\1)20\d\d/
        re.all7 = XRegExp.make(r`
            <groupBeginLookAheadNegative>
            (?:
                  <classBegin>
                      (?! <classNegative>)
                      ((?:  <charInClass>
                         |  <charEscaped>
                      )+) #1
                  <classEnd>
                | (<charInGroup>) #2
                | (?! <backRefer> <groupEnd> <charDigit> )
                  (<charEscaped>) #3
            )
            <groupEnd>
            <classBegin> \\ (?:s\\S|S\\s|d\\D|D\\d) <classEnd>
            (?! <quantifier> )
        `, re, 'sxg');

        //TODO "[\a\b]" => "[ab]", тестирование: "[\|\)]" => "[|)]", "[\^\^\$]" => "[\^^$]", "[\-\]\-\\]" => "[-\]\-\\]"
        //TODO "[(]" => "\("

        callee.re = re;
        //оптимизация своих рег. выражений и самотестирование
        callee.re.all1 = callee(re.all1);
        callee.re.all2 = callee(re.all2);
        callee.re.all3 = callee(re.all3);
        callee.re.all4 = callee(re.all4);
        callee.re.all5 = callee(re.all5);
        callee.re.all6 = callee(re.all6);
        callee.re.all7 = callee(re.all7);
        //console.log(callee.re.all7);
        //process.exit();
    }

    s = pattern.source
        .replace(/\(\?:\)/g, '')
        .replace(/\[0-9\]/g, r`\d`)
        //.replace(/0-9(?=\])/g, r`\d`)  //TODO
        ;
    do {
        ss = s;
        s = s
            .replace(re.all1, '$1')
            .replace(re.all2, '$1')
            .replace(re.all3, '[$1$2]')
            .replace(re.all4, '[$1$2]')
            .replace(re.all5, '[$2$1]')
            .replace(re.all6, '[$1$2]')
            .replace(re.all7, '[^$1$2$3]')
        ;
    } while (ss.length !== s.length);

    ret = new RegExp(
        s,
        pattern.toString().match(/\/([a-zA-Z]*)$/)[1]  //regexp flags
    );
    //сохраняем объект XRegExp и его именные группы
    if ('xregexp' in pattern) ret.xregexp = pattern.xregexp;
    return ret;
};

module.exports = XRegExp;