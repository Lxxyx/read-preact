import { IS_NON_DIMENSIONAL } from '../constants';
import options from '../options';


/** Create an element with the given nodeName.
 *	@param {String} nodeName
 *	@param {Boolean} [isSvg=false]	If `true`, creates an element within the SVG namespace.
 *	@returns {Element} node
 */
export function createNode(nodeName, isSvg) {
	let node = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', nodeName) : document.createElement(nodeName);
	// 创建节点并设置 normalizedNodeName，会根据是否是 SVG 来创建不同的节点
	node.normalizedNodeName = nodeName;
	return node;
}


/** Remove a child node from its parent if attached.
 *	@param {Element} node		The node to remove
 */
export function removeNode(node) {
	// 通过 parentNode 移除节点
	let parentNode = node.parentNode;
	if (parentNode) parentNode.removeChild(node);
}


/** Set a named attribute on the given Node, with special behavior for some names and event handlers.
 *	If `value` is `null`, the attribute/handler will be removed.
 *	@param {Element} node	An element to mutate
 *	@param {string} name	The name/key to set, such as an event or attribute name
 *	@param {any} old	The last value that was set for this name/node pair
 *	@param {any} value	An attribute value, such as a function to be used as an event handler
 *	@param {Boolean} isSvg	Are we currently diffing inside an svg?
 *	@private
 */
export function setAccessor(node, name, old, value, isSvg) {

	// name==='className'时设置class
	if (name==='className') name = 'class';


	if (name==='key') {
		// ignore
	}
	else if (name==='ref') {
		// old 为此节点设置的最后一个值
		// value 当前设置的值
		if (old) old(null);
		if (value) value(node);
	}
	else if (name==='class' && !isSvg) {
		node.className = value || '';
	}
	else if (name==='style') {
		if (!value || typeof value==='string' || typeof old==='string') {
			node.style.cssText = value || '';
		}
		if (value && typeof value==='object') {
			if (typeof old!=='string') {
				// 当 old 的样式在value中不存在时，则移除节点之前设置的该样式
				for (let i in old) if (!(i in value)) node.style[i] = '';
			}
			for (let i in value) {
				// 设置 style 属性，如果是 number，则根据是否是 PX，选择添加 px
				node.style[i] = typeof value[i]==='number' && IS_NON_DIMENSIONAL.test(i)===false ? (value[i]+'px') : value[i];
			}
		}
	}
	else if (name==='dangerouslySetInnerHTML') {
		// dangerouslySetInnerHTML时，设置 innerHTML属性
		if (value) node.innerHTML = value.__html || '';
	}
	else if (name[0]=='o' && name[1]=='n') {
		// 事件处理
		// 如果name存在Capture则使用事件捕获，同时去除 Capture
		let useCapture = name !== (name=name.replace(/Capture$/, ''));
		// 获得事件名称
		name = name.toLowerCase().substring(2);
		if (value) {
			// 如果之前不存在监听事件则直接通过 addEventListener 添加事件
			if (!old) node.addEventListener(name, eventProxy, useCapture);
		}
		else {
			// eventProxy 可以保证移除时，直接移除该属性，避免不必要的查找
			node.removeEventListener(name, eventProxy, useCapture);
		}
		// 初始化 node 的 _listeners 属性为map。并存入函数
		(node._listeners || (node._listeners = {}))[name] = value;
	}
	else if (name!=='list' && name!=='type' && !isSvg && name in node) {

		// 如果属性名不等于 list 和属性名不等于 type，且不是 SVG，但是 Node 中又存在属性名
		// 则调用 setProperty 来设置属性

		setProperty(node, name, value==null ? '' : value);
		if (value==null || value===false) node.removeAttribute(name);
	}
	else {
		// 通过 NS 来判断是否是 SVG
		// name不存在用 node时，使用 setAttribute 和 removeAttribute 来设置属性
		let ns = isSvg && (name !== (name = name.replace(/^xlink\:?/, '')));
		if (value==null || value===false) {
			if (ns) node.removeAttributeNS('http://www.w3.org/1999/xlink', name.toLowerCase());
			else node.removeAttribute(name);
		}
		else if (typeof value!=='function') {
			if (ns) node.setAttributeNS('http://www.w3.org/1999/xlink', name.toLowerCase(), value);
			else node.setAttribute(name, value);
		}
	}
}


/** Attempt to set a DOM property to the given value.
 *	IE & FF throw for certain property-value combinations.
 */
function setProperty(node, name, value) {
	// 设置 DOM 属性，因为 IE 和 火狐会对某些属性组件报错，所以加了 try/catch
	try {
		node[name] = value;
	} catch (e) { }
}


/** Proxy an event to hooked event handlers
 *	@private
 */
function eventProxy(e) {
	// 通过 Proxy 来处理 DOM 事件，如果 options.event 存在，则调用 options.event
	return this._listeners[e.type](options.event && options.event(e) || e);
}
