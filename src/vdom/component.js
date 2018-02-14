import { SYNC_RENDER, NO_RENDER, FORCE_RENDER, ASYNC_RENDER, ATTR_KEY } from '../constants';
import options from '../options';
import { extend } from '../util';
import { enqueueRender } from '../render-queue';
import { getNodeProps } from './index';
import { diff, mounts, diffLevel, flushMounts, recollectNodeTree, removeChildren } from './diff';
import { createComponent, collectComponent } from './component-recycler';
import { removeNode } from '../dom/index';

/** Set a component's `props` (generally derived from JSX attributes).
 *	@param {Object} props
 *	@param {Object} [opts]
 *	@param {boolean} [opts.renderSync=false]	If `true` and {@link options.syncComponentUpdates} is `true`, triggers synchronous rendering.
 *	@param {boolean} [opts.render=true]			If `false`, no render will be triggered.
 */
export function setComponentProps(component, props, opts, context, mountAll) {
	// _disable 组件开始更新
	if (component._disable) return;
	component._disable = true;

	// 如果 ref 相同，则不理会原有的ref，避免不必要的更新
	if ((component.__ref = props.ref)) delete props.ref;
	if ((component.__key = props.key)) delete props.key;

	// 是否是首次挂载、或者是未挂载状态
	if (!component.base || mountAll) {
		// 调用 componentWillMount
		if (component.componentWillMount) component.componentWillMount();
	}
	else if (component.componentWillReceiveProps) {
		// 说明是更新 Props
		component.componentWillReceiveProps(props, context);
	}

	// context 更新
	if (context && context!==component.context) {
		if (!component.prevContext) component.prevContext = component.context;
		component.context = context;
	}

	// props 更新
	if (!component.prevProps) component.prevProps = component.props;
	component.props = props;

	// 设置标志位
	component._disable = false;

	if (opts!==NO_RENDER) {
		// 同步更新
		if (opts===SYNC_RENDER || options.syncComponentUpdates!==false || !component.base) {
			renderComponent(component, SYNC_RENDER, mountAll);
		}
		else {
			// 异步更新
			enqueueRender(component);
		}
	}

	// 更新 ref
	if (component.__ref) component.__ref(component);
}



/** Render a Component, triggering necessary lifecycle events and taking High-Order Components into account.
 *	@param {Component} component
 *	@param {Object} [opts]
 *	@param {boolean} [opts.build=false]		If `true`, component will build and store a DOM node if not already associated with one.
 *	@private
 */
export function renderComponent(component, opts, mountAll, isChild) {
	if (component._disable) return;

	let props = component.props,
		state = component.state,
		context = component.context,
		previousProps = component.prevProps || props,
		previousState = component.prevState || state,
		previousContext = component.prevContext || context,
		isUpdate = component.base,
		nextBase = component.nextBase,
		initialBase = isUpdate || nextBase,
		initialChildComponent = component._component,
		skip = false,
		rendered, inst, cbase;

	// if updating
	if (isUpdate) {
		component.props = previousProps;
		component.state = previousState;
		component.context = previousContext;
		if (opts!==FORCE_RENDER
			&& component.shouldComponentUpdate
			&& component.shouldComponentUpdate(props, state, context) === false) {
			skip = true;
		}
		else if (component.componentWillUpdate) {
			component.componentWillUpdate(props, state, context);
		}
		component.props = props;
		component.state = state;
		component.context = context;
	}

	component.prevProps = component.prevState = component.prevContext = component.nextBase = null;
	component._dirty = false;

	if (!skip) {
		rendered = component.render(props, state, context);

		// context to pass to the child, can be updated via (grand-)parent component
		if (component.getChildContext) {
			context = extend(extend({}, context), component.getChildContext());
		}

		let childComponent = rendered && rendered.nodeName,
			toUnmount, base;

		if (typeof childComponent==='function') {
			// set up high order component link

			let childProps = getNodeProps(rendered);
			inst = initialChildComponent;

			if (inst && inst.constructor===childComponent && childProps.key==inst.__key) {
				setComponentProps(inst, childProps, SYNC_RENDER, context, false);
			}
			else {
				toUnmount = inst;

				component._component = inst = createComponent(childComponent, childProps, context);
				inst.nextBase = inst.nextBase || nextBase;
				inst._parentComponent = component;
				setComponentProps(inst, childProps, NO_RENDER, context, false);
				renderComponent(inst, SYNC_RENDER, mountAll, true);
			}

			base = inst.base;
		}
		else {
			cbase = initialBase;

			// destroy high order component link
			toUnmount = initialChildComponent;
			if (toUnmount) {
				cbase = component._component = null;
			}

			if (initialBase || opts===SYNC_RENDER) {
				if (cbase) cbase._component = null;
				base = diff(cbase, rendered, context, mountAll || !isUpdate, initialBase && initialBase.parentNode, true);
			}
		}

		if (initialBase && base!==initialBase && inst!==initialChildComponent) {
			let baseParent = initialBase.parentNode;
			if (baseParent && base!==baseParent) {
				baseParent.replaceChild(base, initialBase);

				if (!toUnmount) {
					initialBase._component = null;
					recollectNodeTree(initialBase, false);
				}
			}
		}

		if (toUnmount) {
			unmountComponent(toUnmount);
		}

		component.base = base;
		if (base && !isChild) {
			let componentRef = component,
				t = component;
			while ((t=t._parentComponent)) {
				(componentRef = t).base = base;
			}
			base._component = componentRef;
			base._componentConstructor = componentRef.constructor;
		}
	}

	if (!isUpdate || mountAll) {
		mounts.unshift(component);
	}
	else if (!skip) {
		// Ensure that pending componentDidMount() hooks of child components
		// are called before the componentDidUpdate() hook in the parent.
		// Note: disabled as it causes duplicate hooks, see https://github.com/developit/preact/issues/750
		// flushMounts();

		if (component.componentDidUpdate) {
			component.componentDidUpdate(previousProps, previousState, previousContext);
		}
		if (options.afterUpdate) options.afterUpdate(component);
	}

	if (component._renderCallbacks!=null) {
		while (component._renderCallbacks.length) component._renderCallbacks.pop().call(component);
	}

	if (!diffLevel && !isChild) flushMounts();
}



/** Apply the Component referenced by a VNode to the DOM.
 *	@param {Element} dom	The DOM node to mutate
 *	@param {VNode} vnode	A Component-referencing VNode
 *	@returns {Element} dom	The created/mutated element
 *	@private
 */
export function buildComponentFromVNode(dom, vnode, context, mountAll) {
	// 把 Vnode 转译成 dom node

	// isDirectOwner => 由该 Vnode 直接产生的 component
	// isOwner => 由该 VNode 派生的子component

	let c = dom && dom._component,
		originalComponent = c,
		oldDom = dom,
		isDirectOwner = c && dom._componentConstructor===vnode.nodeName,
		isOwner = isDirectOwner,
		props = getNodeProps(vnode);
	while (c && !isOwner && (c=c._parentComponent)) {
		isOwner = c.constructor===vnode.nodeName;
	}

	if (c && isOwner && (!mountAll || c._component)) {
		// 如果是子组件，则调用更新Props的函数，来实现更新
		setComponentProps(c, props, ASYNC_RENDER, context, mountAll);
		dom = c.base;
	}
	else {
		// 如果不是，则移除节点，重新插入
		if (originalComponent && !isDirectOwner) {
			unmountComponent(originalComponent);
			dom = oldDom = null;
		}

		c = createComponent(vnode.nodeName, props, context);
		if (dom && !c.nextBase) {
			c.nextBase = dom;
			// passing dom/oldDom as nextBase will recycle it if unused, so bypass recycling on L229:
			oldDom = null;
		}
		setComponentProps(c, props, SYNC_RENDER, context, mountAll);
		dom = c.base;

		if (oldDom && dom!==oldDom) {
			oldDom._component = null;
			recollectNodeTree(oldDom, false);
		}
	}

	return dom;
}



/** Remove a component from the DOM and recycle it.
 *	@param {Component} component	The Component instance to unmount
 *	@private
 */
export function unmountComponent(component) {
	// 调用 beforeUnmount
	if (options.beforeUnmount) options.beforeUnmount(component);

	let base = component.base;

	component._disable = true;

	// 调用 componentWillUnmount
	if (component.componentWillUnmount) component.componentWillUnmount();

	// 卸载 dom 节点
	component.base = null;

	// recursively tear down & recollect high-order component children:
	let inner = component._component;
	if (inner) {
		unmountComponent(inner);
	}
	else if (base) {
		if (base[ATTR_KEY] && base[ATTR_KEY].ref) base[ATTR_KEY].ref(null);

		// 设置 base 为 null
		component.nextBase = base;

		// 移除 Node
		removeNode(base);
		// 将 Component 收集至 Map 中以待下次使用
		collectComponent(component);

		// 移除 Children
		removeChildren(base);
	}

	if (component.__ref) component.__ref(null);
}
