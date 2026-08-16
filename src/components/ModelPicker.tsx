import { Check, ChevronDown, Sparkles, Star, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MODEL_OPTIONS, modelCatalogInfo } from '../config';
import { useAppStore } from '../store';
import type { ProviderKind, ProviderProfile } from '../types';
import { favoriteModelId } from '../lib/preferences';

interface PanelPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export function ModelPicker({
  conversationId,
  profile,
  variant = 'topbar',
}: {
  conversationId: string;
  profile: ProviderProfile;
  variant?: 'topbar' | 'settings';
}) {
  const [open, setOpen] = useState(false);
  const [providerKind, setProviderKind] = useState<ProviderKind>(profile.kind);
  const [panelPosition, setPanelPosition] = useState<PanelPosition>();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const profiles = useAppStore((state) => state.profiles);
  const favoriteModels = useAppStore((state) => state.favoriteModels);
  const addFavoriteModel = useAppStore((state) => state.addFavoriteModel);
  const removeFavoriteModel = useAppStore((state) => state.removeFavoriteModel);
  const saveProfile = useAppStore((state) => state.saveProfile);
  const updateConversation = useAppStore((state) => state.updateConversation);

  useEffect(() => setProviderKind(profile.kind), [profile.kind]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = rootRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const margin = 12;
      const gap = 8;
      const width = Math.min(680, window.innerWidth - margin * 2);
      const left = Math.min(
        window.innerWidth - margin - width,
        Math.max(margin, trigger.left + trigger.width / 2 - width / 2),
      );
      const spaceBelow = window.innerHeight - trigger.bottom - margin - gap;
      const spaceAbove = trigger.top - margin - gap;
      const openAbove = spaceBelow < 300 && spaceAbove > spaceBelow;
      const viewportHeight = Math.max(240, window.innerHeight - margin * 2);
      const maxHeight = Math.min(520, viewportHeight, Math.max(240, openAbove ? spaceAbove : spaceBelow));
      const preferredTop = openAbove ? trigger.top - maxHeight - gap : trigger.bottom + gap;
      const top = Math.min(window.innerHeight - margin - maxHeight, Math.max(margin, preferredTop));
      setPanelPosition({ left, top, width, maxHeight });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const providers = useMemo(() => {
    const byKind = new Map<ProviderKind, ProviderProfile>();
    for (const item of profiles) if (!byKind.has(item.kind)) byKind.set(item.kind, item);
    return [...byKind.values()];
  }, [profiles]);
  const selectedProvider = providers.find((item) => item.kind === providerKind) ?? profile;
  const models = MODEL_OPTIONS[selectedProvider.kind];

  const chooseProfile = async (next: ProviderProfile) => {
    await updateConversation(conversationId, { providerProfileId: next.id });
    setProviderKind(next.kind);
    setOpen(false);
  };

  const profileForModel = (source: ProviderProfile, modelId: string): ProviderProfile => {
    const option = MODEL_OPTIONS[source.kind].find((item) => item.id === modelId);
    const catalog = modelCatalogInfo(modelId, option?.contextWindow ?? source.contextWindow);
    return {
      ...source,
      model: modelId,
      contextWindow: catalog.contextWindow,
      capabilities: {
        ...source.capabilities,
        webSearch: option ? Boolean(option.webSearch) : source.capabilities.webSearch,
        vision: catalog.vision ?? source.capabilities.vision,
      },
    };
  };

  const chooseModel = async (modelId: string) => {
    const updated = profileForModel(selectedProvider, modelId);
    await saveProfile(updated);
    await chooseProfile(updated);
  };

  const chooseFavorite = async (profileId: string, modelId: string) => {
    const source = profiles.find((item) => item.id === profileId);
    if (!source) return;
    const updated = profileForModel(source, modelId);
    await saveProfile(updated);
    await chooseProfile(updated);
  };

  const toggleFavorite = (item: { id: string; label: string }) => {
    const id = favoriteModelId(selectedProvider.id, item.id);
    if (favoriteModels.some((favorite) => favorite.id === id)) removeFavoriteModel(id);
    else addFavoriteModel({ id, profileId: selectedProvider.id, model: item.id, label: item.label });
  };

  return (
    <div className={`model-select model-select-${variant}`} ref={rootRef}>
      <button className="model-select-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {profile.kind === 'stingy' ? <Sparkles size={15} /> : null}
        <span>{profile.kind === 'stingy' ? 'StingyChat' : profile.model}</span>
        {profile.kind === 'stingy' ? <b className="free-badge">Free</b> : null}
        <ChevronDown size={15} />
      </button>
      {createPortal(<AnimatePresence>
        {open ? (
          <motion.div
            ref={panelRef}
            className="model-select-panel"
            style={panelPosition ? ({
              '--model-panel-left': `${panelPosition.left}px`,
              '--model-panel-top': `${panelPosition.top}px`,
              '--model-panel-width': `${panelPosition.width}px`,
              '--model-panel-max-height': `${panelPosition.maxHeight}px`,
            } as CSSProperties) : undefined}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.16 }}
          >
            <div className="common-models">
              <div className="common-models-heading">
                <small>常用模型</small>
                <span>使用模型列表中的星标进行添加</span>
              </div>
              <div className="favorite-model-list">
                {favoriteModels.length ? favoriteModels.map((item) => {
                  const favoriteProfile = profiles.find((profileItem) => profileItem.id === item.profileId);
                  if (!favoriteProfile) return null;
                  return (
                    <div className="favorite-model" key={item.id}>
                      <button type="button" onClick={() => void chooseFavorite(item.profileId, item.model)} title={`${favoriteProfile.name} · ${item.model}`}>
                        <span>{favoriteProfile.kind === 'stingy' ? 'StingyChat' : item.label}</span>
                        {favoriteProfile.kind === 'stingy' ? <b className="free-badge">Free</b> : null}
                      </button>
                      <button className="favorite-remove" type="button" aria-label={`从常用模型中移除 ${item.label}`} onClick={() => removeFavoriteModel(item.id)}>
                        <X size={13} />
                      </button>
                    </div>
                  );
                }) : <p className="favorite-empty">尚未添加常用模型。可在下方模型列表中选择星标。</p>}
              </div>
            </div>
            <div className="model-select-grid">
              <div className="provider-column">
                <small>供应商</small>
                {providers.map((item) => (
                  <button className={item.kind === providerKind ? 'active' : ''} key={item.id} type="button" onClick={() => setProviderKind(item.kind)}>
                    {item.name}{item.kind === providerKind ? <Check size={14} /> : null}
                  </button>
                ))}
              </div>
              <div className="model-column">
                <small>模型</small>
                {models.length ? models.map((item) => (
                  <div className={`model-option ${selectedProvider.model === item.id ? 'active' : ''}`} key={item.id}>
                    <button type="button" onClick={() => void chooseModel(item.id)}>
                      <span>{item.label}</span>
                      {selectedProvider.kind === 'stingy' ? <b className="free-badge">Free</b> : null}
                      {selectedProvider.model === item.id ? <Check size={14} /> : null}
                    </button>
                    <button
                      className={`favorite-toggle ${favoriteModels.some((favorite) => favorite.id === favoriteModelId(selectedProvider.id, item.id)) ? 'active' : ''}`}
                      type="button"
                      aria-label={`${favoriteModels.some((favorite) => favorite.id === favoriteModelId(selectedProvider.id, item.id)) ? '从常用模型中移除' : '添加到常用模型'} ${item.label}`}
                      aria-pressed={favoriteModels.some((favorite) => favorite.id === favoriteModelId(selectedProvider.id, item.id))}
                      onClick={() => toggleFavorite(item)}
                    ><Star size={14} /></button>
                  </div>
                )) : (
                  <div className="model-option active">
                    <button type="button" onClick={() => void chooseProfile(selectedProvider)}>
                      <span>{selectedProvider.model}</span><Check size={14} />
                    </button>
                    <button
                      className={`favorite-toggle ${favoriteModels.some((favorite) => favorite.id === favoriteModelId(selectedProvider.id, selectedProvider.model)) ? 'active' : ''}`}
                      type="button"
                      aria-label={`${favoriteModels.some((favorite) => favorite.id === favoriteModelId(selectedProvider.id, selectedProvider.model)) ? '从常用模型中移除' : '添加到常用模型'} ${selectedProvider.model}`}
                      aria-pressed={favoriteModels.some((favorite) => favorite.id === favoriteModelId(selectedProvider.id, selectedProvider.model))}
                      onClick={() => toggleFavorite({ id: selectedProvider.model, label: selectedProvider.model })}
                    ><Star size={14} /></button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>, document.body)}
    </div>
  );
}
